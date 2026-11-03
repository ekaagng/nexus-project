# NEXUS — Marketing Intelligence & Operations PWA

**Baseline:** PRD NEXUS v0.3 · Nocturne / Midnight Observatory  
**Current implementation:** React/Vite demo frontend + PostgreSQL/Fastify backend foundations.

The frontend now gates the app on a server-verified OIDC browser session, loads workspace membership from the API, and connects account/session controls plus Owner-only Access Management. Campaign, brief, task, content, Ads, sales, KOL and budget records remain local demo data; they are isolated by workspace ID in browser storage and are not shared server records. Provider APIs are not connected.

## Frontend already implemented

- Responsive Nocturne app shell and all main workflow destinations.
- Local CRUD for campaigns, briefs, tasks, content, expenses, KOL, orders and competitors.
- CSV preview/import and CSV/JSON export.
- Source-aware demo placeholders; actual sales remain separate from Ads-attributed revenue.
- PWA manifest, service worker shell and offline behavior.
- Asia/Jakarta date helpers.

## Backend foundation

- Fastify API on port 8787, separate from Vite's port 5173.
- PostgreSQL tables for workspaces, memberships, integration connections/secrets, sync jobs/cursors, orders, daily Ads metrics, social metrics, content snapshots, source lineage and audit logs.
- PostgreSQL Row-Level Security policies for workspace-scoped tables.
- OIDC JWT verification through configured issuer, audience and JWKS URL.
- AES-256-GCM token-vault utility. Secrets are not exposed by integration API responses.
- Server-only provider connector registry and normalized order upsert boundary.
- Health, workspace, integration metadata and sync-job API routes.

## Workspace access management

The `feat/authentication-management` child branch adds:

- Owner-only member and invitation management endpoints.
- Provider-neutral OIDC Authorization Code + PKCE login flow with state and nonce validation.
- Opaque browser sessions stored as SHA-256 hashes, fixed expiry, per-request revalidation, logout and per-session/revoke-all controls.
- HttpOnly/SameSite cookies, production Secure-cookie enforcement, exact-Origin CSRF validation and credentialed CORS limited to configured origins.
- React session gate, workspace selection/onboarding, invite acceptance, account session list/revocation/logout and Owner-only Access Management UI.
- One-time 256-bit invitation tokens; only SHA-256 token hashes are stored.
- Seven-day invitation expiry and a database-reserved seat for every pending invite.
- Verified-email matching during invitation acceptance.
- Member/invitation revocation and audit events.
- Database enforcement of the five-seat limit and immutable initial Owner.

See [Workspace Access Management](docs/WORKSPACE_ACCESS_MANAGEMENT.md) for API contracts and security behavior.

No Meta Ads, Scalev, Lynk.id, Instagram, TikTok or YouTube provider adapter is registered yet. Provider OAuth callbacks, token refresh, background worker execution and live dashboard reads remain separate implementation stages.

## Requirements

- Node.js 20+
- npm
- PostgreSQL 15+

## Local setup

1. Install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the restricted `nexus_app` connection and `MIGRATION_DATABASE_URL` to the dedicated schema-owner connection; migrations will refuse to run without it.

3. Create the PostgreSQL database and roles, then apply migrations:

   ```bash
   npm run db:migrate
   ```

4. Run the frontend:

   ```bash
   npm run dev
   ```

5. In a second terminal, run the API:

   ```bash
   npm run dev:api
   ```

6. Check API status:

   - `http://localhost:8787/health/live`
   - `http://localhost:8787/health/ready`

Frontend API calls use `VITE_API_BASE_URL` (standard local value: `http://localhost:8787`) with credentialed requests; configure the API `CORS_ORIGINS` to include the frontend origin. Browser login requires OIDC client settings and `APP_ENCRYPTION_KEY`. The service worker never caches `/api/*` responses. Business-domain data is still browser-local and must not be treated as shared workspace data.

## Database security requirement

Create separate `nexus_migrator` and `nexus_app` PostgreSQL roles before migrating. Grant the migrator `CREATE` on schema `public`; grant the app role `USAGE` on schema `public`. Run migrations with `MIGRATION_DATABASE_URL` as `nexus_migrator`, and use `DATABASE_URL` as `nexus_app`. The migration grants the runtime role table DML permissions and access to narrowly scoped helper functions. The runtime role must **not** own tables and must not have `BYPASSRLS`. PostgreSQL table owners bypass RLS unless forced, so using the migration owner as the API role defeats the tenant boundary.

The API sets `nexus.user_id` and `nexus.workspace_id` with transaction-local settings. Keep them transaction-scoped when using pooled connections.

## Useful commands

```bash
npm run typecheck
npm run typecheck:server
npm run build
npm run build:server
npm run test:server
```

## Documentation

- [Data Integration Foundation](docs/DATA_INTEGRATION_FOUNDATION.md)
- [Workspace Access Management](docs/WORKSPACE_ACCESS_MANAGEMENT.md)
- [Production Gaps](docs/PRODUCTION_GAPS.md)

## Explicit production gaps

This is not yet a live multi-user or provider-connected release. The production identity-provider login flow and server-owned browser session lifecycle are not implemented. Invitation delivery is manual and the frontend Access Management UI is not connected to the new API. Official provider OAuth/API adapters, token refresh, queue worker and retry scheduler, connector-specific normalization, live dashboard queries, deployment secrets management, operational monitoring and security testing remain before production use.
