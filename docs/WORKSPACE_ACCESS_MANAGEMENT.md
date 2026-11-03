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

All routes require `Authorization: Bearer <OIDC access token>`, except the public health endpoints. Workspace administration routes also require `X-Workspace-Id: <uuid>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/workspaces/members` | Owner | List active workspace members |
| GET | `/api/v1/workspaces/invitations` | Owner | List invitation history |
| POST | `/api/v1/workspaces/invitations` | Owner | Create a Member invitation |
| DELETE | `/api/v1/workspaces/invitations/:invitationId` | Owner | Revoke a pending invitation |
| DELETE | `/api/v1/workspaces/members/:memberUserId` | Owner | Revoke an active Member |
| POST | `/api/v1/workspaces/invitations/accept` | Authenticated invitee | Accept an invitation matching the verified token email |

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

## Explicitly not included

- Login page, OIDC authorization-code/PKCE callback, or a selected production identity provider.
- Opaque browser sessions, refresh/rotation, logout-all, CSRF/session revocation controls.
- Email delivery, invitation deep-link UI, or resend-email integration.
- Frontend Access Management screen wiring; the current frontend remains localStorage-backed.
- Granular per-feature Member permissions.

Do not treat this branch as a complete production authentication release. Configure and review the identity provider, verified-email claim behavior, session model, email delivery, deployment secrets and frontend integration before inviting real team members.
