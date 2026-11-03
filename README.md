# NEXUS — Marketing Intelligence & Operations PWA

**Baseline:** PRD NEXUS v0.3 · Nocturne / Midnight Observatory  
**Current implementation:** React/Vite demo frontend + backend data-integration foundation.

The frontend still runs as a local demo by default. The backend foundation adds a PostgreSQL schema, workspace-scoped API, OIDC token verification boundary, encrypted-secret utility, normalized integration data contracts and persistent sync-job metadata. It does not mean provider APIs are connected.

## Frontend already implemented

- Responsive Nocturne app shell and all main workflow destinations.
- Local CRUD for campaigns, briefs, tasks, content, expenses, KOL, orders and competitors.
- CSV preview/import and CSV/JSON export.
- Source-aware demo placeholders; actual sales remain separate from Ads-attributed revenue.
- PWA manifest, service worker shell and offline behavior.
- Asia/Jakarta date helpers.

## Backend foundation added

- Fastify API on port 8787, separate from Vite's port 5173.
- PostgreSQL tables for workspaces, memberships, integration connections/secrets, sync jobs/cursors, orders, daily Ads metrics, social metrics, content snapshots, source lineage and audit logs.
- PostgreSQL Row-Level Security policies for workspace-scoped tables.
- OIDC JWT verification through configured issuer, audience and JWKS URL.
- AES-256-GCM token-vault utility. Secrets are not exposed by integration API responses.
- Server-only provider connector registry and normalized order upsert boundary.
- Health, workspace, integration metadata and sync-job API routes.

No Meta Ads, Scalev, Lynk.id, Instagram, TikTok or YouTube provider adapter is registered yet. OAuth callbacks, token refresh, background worker execution and live dashboard reads remain separate implementation stages.

## Requirements

- Node.js 20+
- npm
- PostgreSQL 15+

## Local setup

1. Install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and configure `DATABASE_URL`. Set `MIGRATION_DATABASE_URL` to a dedicated schema-owner connection; migrations will refuse to run without it.

3. Create the PostgreSQL database and roles, then apply the migration:

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

The existing frontend uses localStorage key `nexus.workspace.v03`; it is not yet wired to these API endpoints. Authenticated routes return an explicit 503 until OIDC settings are configured. Do not enable fake local authentication.

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
- [Production Gaps](docs/PRODUCTION_GAPS.md)

## Explicit production gaps

This is not yet a live multi-user or provider-connected release. Identity-provider deployment configuration, workspace invite/allowlist workflows, official provider OAuth/API adapters, token refresh, queue worker and retry scheduler, connector-specific normalization, live dashboard queries, deployment secrets management, operational monitoring and security testing remain before production use.
