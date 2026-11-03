# NEXUS — Data Integration Foundation

**Branch:** `feat/data-integration-foundation`  
**Scope:** backend and normalized data foundation; no provider is claimed to be connected.

## 1. Target architecture

```text
Meta Ads / Scalev / Lynk.id / Instagram / TikTok / YouTube
                         |
                 Provider adapters
          OAuth, scope checks, API pagination,
          rate limits, retries and normalization
                         |
                Sync jobs + cursors
                         |
              PostgreSQL ingestion layer
        workspace isolation + idempotent upserts
                         |
              Normalized source tables
         orders | ads daily | social daily
                  | content snapshots
                         |
            Dashboard / Reports / Analytics
```

Provider-specific fields must be normalized before they reach dashboard queries. The dashboard must not need to understand each provider's API payload.

## 2. Backend baseline

- **Runtime:** Node.js 20+, TypeScript and Fastify.
- **Database:** PostgreSQL.
- **Identity boundary:** OIDC JWT validation through issuer, audience and JWKS configuration. The identity provider itself is deliberately not selected in code.
- **Tenant boundary:** every workspace request uses `X-Workspace-Id`; membership is checked inside a transaction. PostgreSQL Row-Level Security is enabled on tenant tables. Database constraints also enforce one active Owner and a maximum of five active members per workspace.
- **Secret storage:** AES-256-GCM envelope for access/refresh tokens. Ciphertext, IV, authentication tag and key version are stored separately from connection metadata. The browser never receives token values.
- **Connector boundary:** server-only registry and adapter interface. No provider adapter is registered in this baseline.
- **Sync persistence:** connection-scoped jobs, period windows, idempotency keys, cursors, attempt counts and safe error fields are modeled in PostgreSQL.

## 3. Normalized data model

| Table | Purpose |
|---|---|
| `workspaces`, `workspace_members` | Workspace ownership, active membership, one active Owner, and at most five active seats |
| `integration_connections` | Provider/account metadata and connection health |
| `integration_secrets` | Encrypted access and refresh tokens |
| `sync_jobs`, `sync_cursors` | Sync request history and incremental cursor state |
| `orders` | Actual transaction/order records from Scalev, Lynk.id or manual imports |
| `ad_performance_daily` | Daily account/campaign/ad-level spend and attributed performance |
| `social_account_daily_metrics` | Daily account-level social metrics |
| `content_performance_snapshots` | Per-content performance snapshots |
| `source_lineage` | Provider record ID, payload hash, timestamps and validation state |
| `audit_logs` | Actor, action and workspace audit trail |

Amounts use `NUMERIC(18,2)`, not floating-point columns. Rates and counters remain nullable when the provider does not return a metric. Missing data must be presented as N/A, not fabricated as zero.

### Revenue definitions

- **Actual revenue:** calculated from normalized order records and their payment/refund state.
- **Ads-attributed revenue:** kept in the advertising dataset with its attribution window and provider.
- **Blended ROAS:** calculated later as actual revenue divided by comparable total paid media spend. It is not the sum of sales-platform revenue and Meta-attributed revenue.
- Orders and ad metrics retain provider, external record identifiers and source timestamps for reconciliation.

## 4. API surface added

| Method | Path | Purpose |
|---|---|---|
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | Database readiness |
| GET | `/api/v1/workspaces` | List active memberships for the authenticated user |
| POST | `/api/v1/workspaces` | Create a workspace and its initial Owner membership |
| GET | `/api/v1/integrations` | List connection metadata for the selected workspace |
| GET | `/api/v1/sync-jobs` | List sync job history |
| POST | `/api/v1/sync-jobs` | Enqueue a job only when a matching server adapter is registered |

All API routes except health endpoints require a Bearer access token. Workspace-scoped routes also require a valid `X-Workspace-Id`. Missing OIDC configuration returns an explicit 503; it does not silently enable a development identity.

## 5. Local setup

1. Install Node.js 20+ and PostgreSQL 15+ (the schema uses column-specific `ON DELETE SET NULL` foreign keys).
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and fill in `DATABASE_URL`.
4. Apply the schema using `npm run db:migrate`.
5. Start the API using `npm run dev:api`.
6. Check `http://localhost:8787/health/live` and `http://localhost:8787/health/ready`.

The migration runner intentionally requires `MIGRATION_DATABASE_URL`. Do not reuse the runtime `nexus_app` role for schema changes.

The existing frontend remains on Vite port 5173. Its demo data is still localStorage-backed; this foundation does not silently replace the demo UI with unverified live metrics.

## 6. Database role and RLS requirement

Create separate roles before migrating (replace passwords with strong values):

```sql
CREATE ROLE nexus_migrator LOGIN PASSWORD 'replace-this-migration-password';
CREATE ROLE nexus_app LOGIN PASSWORD 'replace-this-runtime-password';
GRANT CONNECT ON DATABASE nexus TO nexus_migrator, nexus_app;
GRANT CREATE ON SCHEMA public TO nexus_migrator;
GRANT USAGE ON SCHEMA public TO nexus_app;
```

Run migrations using `MIGRATION_DATABASE_URL` as `nexus_migrator`. The migration grants the minimum table DML privileges and helper-function execution to `nexus_app`. The API's `DATABASE_URL` must use `nexus_app`, which must **not** own tables and must not have `BYPASSRLS`. PostgreSQL table owners bypass RLS unless forced, so running the API as the migration owner would invalidate the isolation boundary.

The API sets transaction-local `nexus.user_id` and `nexus.workspace_id` values. Never replace these with session-level settings on pooled connections.

## 7. Environment variables

- `DATABASE_URL`: runtime database connection.
- `MIGRATION_DATABASE_URL`: required schema-owner connection used only by migrations.
- `DATABASE_SSL`: enable certificate-verified TLS for PostgreSQL.
- `CORS_ORIGINS`: comma-separated frontend origins.
- `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`: OIDC access-token verification settings.
- `APP_ENCRYPTION_KEY`: base64-encoded 32-byte AES key; required in production.

Do not place provider secrets in `VITE_*` variables or commit real `.env` values.

Generate a local encryption key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## 8. Deliberate limitations / next implementation stage

This commit is a foundation, not a live integration release.

- No Meta Ads, Scalev, Lynk.id, Instagram, TikTok or YouTube OAuth/API adapter is registered yet.
- Provider-specific OAuth callback, state/PKCE storage and token refresh flows are not implemented.
- The persistent sync job schema and enqueue contract exist, but a production worker, retry scheduler and provider adapters are the next stage.
- The current frontend still uses its v0.3 localStorage demo dataset.
- No shared live dashboard metrics are exposed until real adapters, source-specific validation and reconciliation rules are implemented.
- Production login provider, workspace invite/allowlist policy, deployment secrets management and database runtime-role provisioning still require deployment decisions.

Do not enter real customer or provider credentials until the identity provider, database roles, encryption-key rotation and provider OAuth scopes have been configured and reviewed.
