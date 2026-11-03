# NEXUS — Workspace Access Management

**Branch:** `feat/authentication-management`  
**Parent:** `feat/data-integration-foundation`  
**Scope:** backend access governance for workspace members. This does not select or implement a production login provider.

## Rules

- The workspace creator remains the immutable Owner.
- Only the Owner can list members, list invitations, invite a Member, revoke an invitation, or revoke a Member.
- Invitations can create the `member` role only. Admin/viewer permissions are not exposed through this API.
- One workspace can reserve at most five seats in total: the Owner plus active Members and pending invitations.
- An invitation expires after seven days.
- Accepting an invitation requires a valid OIDC access token with `email` and `email_verified: true`; the verified email must match the invitation address.
- A revoked Member can be invited again. The rejoin flow reuses the existing membership row without creating a sixth seat.

## API

Protected routes accept either `Authorization: Bearer <OIDC access token>` or the server-owned `nexus_session` cookie. Browser session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Workspace administration routes also require `X-Workspace-Id: <uuid>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/workspaces/members` | Owner | List active workspace members |
| GET | `/api/v1/workspaces/invitations` | Owner | List invitation history |
| POST | `/api/v1/workspaces/invitations` | Owner | Create a Member invitation |
| DELETE | `/api/v1/workspaces/invitations/:invitationId` | Owner | Revoke a pending invitation |
| DELETE | `/api/v1/workspaces/members/:memberUserId` | Owner | Revoke an active Member |
| POST | `/api/v1/workspaces/invitations/accept` | Authenticated invitee | Accept an invitation matching the verified token email |
| GET | `/api/v1/auth/oidc/status` | Public | Report whether required OIDC login configuration is present (no secrets returned) |
| GET | `/api/v1/auth/oidc/start` | Public | Start OIDC Authorization Code + PKCE login |
| GET | `/api/v1/auth/oidc/callback` | OIDC callback | Verify state, exchange code, validate ID token, create session |
| GET | `/api/v1/auth/session` | Authenticated | Return the current identity and auth method |
| GET | `/api/v1/auth/sessions` | Authenticated | List the user's active browser sessions |
| DELETE | `/api/v1/auth/sessions/:sessionId` | Authenticated | Revoke one of the user's sessions |
| POST | `/api/v1/auth/logout` | Browser session | Revoke the current browser session |
| POST | `/api/v1/auth/sessions/revoke-all` | Authenticated | Revoke every active browser session for the user |

### Create invitation

Request:

```http
POST /api/v1/workspaces/invitations
Authorization: Bearer <owner-access-token>
X-Workspace-Id: <workspace-uuid>
Content-Type: application/json

{
  "email": "member@example.com"
}
```

The successful response is returned once:

```json
{
  "invitation": {
    "id": "invitation-uuid",
    "email": "member@example.com",
    "role": "member",
    "status": "pending",
    "expires_at": "..."
  },
  "invitationToken": "<one-time-secret>",
  "delivery": "manual"
}
```

The token contains 256 bits of randomness. PostgreSQL stores only its SHA-256 hash. The response uses `Cache-Control: no-store`; do not log or persist the token in analytics. The Owner must send the token through a trusted channel. No email sender or invitation URL generation is included in this stage.

### Accept invitation

Request:

```http
POST /api/v1/workspaces/invitations/accept
Authorization: Bearer <invitee-access-token>
Content-Type: application/json

{
  "token": "<one-time-secret>"
}
```

The API hashes the supplied token and delegates the membership transition to a narrowly granted PostgreSQL `SECURITY DEFINER` function. The function checks the invitation status/expiry and verified email match, converts the reserved seat into an active membership, and writes an audit event. It does not allow a client to choose a workspace ID or role.

## Database and security

Migration: `server/migrations/002_workspace_access_management.sql`.

- Invitation rows are protected by workspace-scoped RLS, with read/write access limited to the active Owner.
- A pending invitation reserves a corresponding `workspace_members` seat with status `invited`; the existing database trigger remains the source of truth for the five-seat limit.
- Invitation secrets are stored as SHA-256 hashes. The raw token is returned only in the creation response.
- Acceptance runs in a transaction and checks the verified email claim against the invitation email.
- Invitation create, accept, expiry, revoke, and member revoke actions are written to `audit_logs`.
- Initial Owner immutability and tenant isolation continue to be enforced by the existing database constraints and RLS policies.


## Browser login and session management

The API implements a provider-neutral OIDC Authorization Code flow with PKCE (S256). It does not select or configure a specific identity provider.

1. The browser navigates to `GET /api/v1/auth/oidc/start`.
2. The API discovers the configured issuer, creates random `state`, `nonce`, and PKCE values, stores only hashes for state/nonce, and encrypts the short-lived code verifier with `APP_ENCRYPTION_KEY`.
3. The API sets an HttpOnly, SameSite=Lax state cookie and redirects to the provider.
4. The provider returns to `OIDC_REDIRECT_URI`. The callback verifies the state against both the cookie and the database, consumes the transaction once, exchanges the authorization code, and validates the ID token signature, issuer, audience, expiry and nonce.
5. The API creates a random opaque session token, stores only its SHA-256 hash, sets the HttpOnly session cookie, and redirects to `AUTH_FRONTEND_URL`.

### Session behavior

- Default session lifetime is 12 hours; configure `AUTH_SESSION_TTL_SECONDS` between 300 seconds and 7 days.
- Sessions are fixed-expiry in this stage. They are not silently extended or rotated.
- Every protected cookie-authenticated request revalidates the session against PostgreSQL. Revocation therefore takes effect on the next request.
- Unsafe cookie-authenticated methods require an exact `Origin` match in `CORS_ORIGINS`; CORS allows credentials only for configured origins.
- `POST /api/v1/auth/logout` revokes the current browser session. `POST /api/v1/auth/sessions/revoke-all` revokes all active browser sessions.
- Existing Bearer-token authentication remains supported. Identity-provider access-token revocation and global IdP logout are outside this session store.

### Required environment settings

Configure these values on the API server only. Never put the client secret or encryption key in a `VITE_*` variable.

| Variable | Purpose |
|---|---|
| `OIDC_ISSUER_URL` | Exact OIDC issuer identifier |
| `OIDC_AUDIENCE` | Expected audience for existing API Bearer tokens |
| `OIDC_JWKS_URL` | Trusted signing-key endpoint |
| `OIDC_CLIENT_ID` | OIDC browser client ID |
| `OIDC_CLIENT_SECRET` | Optional for public PKCE clients; required for Basic/Post client authentication |
| `OIDC_CLIENT_AUTH_METHOD` | `client_secret_basic`, `client_secret_post`, or `none` |
| `OIDC_REDIRECT_URI` | Exact API callback URI registered with the identity provider |
| `AUTH_FRONTEND_URL` | Frontend destination after successful login; origin must be in `CORS_ORIGINS` |
| `AUTH_SESSION_TTL_SECONDS` | Fixed browser session lifetime |
| `SESSION_COOKIE_SECURE` | Must be `true` in production |
| `APP_ENCRYPTION_KEY` | Base64-encoded 32-byte key used to encrypt PKCE transaction secrets |

For local development, configure the identity provider callback as `http://localhost:8787/api/v1/auth/oidc/callback`, frontend origin as `http://localhost:5173`, and keep `SESSION_COOKIE_SECURE=false`. For production, all public endpoints and the frontend must use HTTPS. `SameSite=Lax` means the browser frontend and API should share the same registrable site; unrelated frontend/API domains require an explicit cookie deployment decision.

## Frontend integration

The React app now uses the server-owned session as its authentication gate:

- On startup it checks `GET /api/v1/auth/session`. A 401 shows the sign-in screen; network/server failures show a retry state.
- The sign-in action navigates to `/api/v1/auth/oidc/start`. It does not store an access token in browser storage.
- `GET /api/v1/workspaces` populates the authenticated user's workspace selector. A first-time account can create a workspace or accept a one-time invitation.
- The account menu reads `GET /api/v1/auth/sessions` and supports single-session revoke, revoke-all and logout.
- The Owner-only Access Management page uses the workspace member/invitation endpoints. It shows an invitation token once, with manual secure delivery; there is no email sender.
- Existing campaign, content, Ads and other operational demo records remain browser-local and are not yet server-backed. The signed-in UI labels this explicitly. The local cache key is namespaced by workspace ID.
- The service worker excludes `/api/*` responses from caching. Authentication and workspace API responses must stay network-only.

Configure `VITE_API_BASE_URL=http://localhost:8787` in the frontend `.env` for the standard local split-port setup. Its browser origin must match the server's `CORS_ORIGINS`. Keep the frontend and API on the same site in production so the `SameSite=Lax` session cookie is sent.

## Explicitly not included

- Server-backed campaign/brief/task/content/Ads/KOL/sales/budget records and removal of all local demo-data behavior.
- Selection/registration of a production identity provider, provider-specific consent configuration, and global IdP logout.
- Automatic browser-session renewal/rotation and account deactivation/suspension.
- Email delivery, invitation deep-link UI, and resend-email integration.
- Granular per-feature Member permissions.

Do not treat this branch as a complete production authentication release. Configure and review the identity provider, exact callback URL, verified-email claim behavior, deployment secrets, API cookie/site topology, operational monitoring and server-side business-data migration before inviting real team members.
