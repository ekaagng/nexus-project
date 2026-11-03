# NEXUS — Business Data API

**Branch:** `feat/business-data-api`  
**Base:** `feat/data-integration-foundation`  
**Scope:** workspace-scoped persistence for editable marketing operations data. The frontend still uses its existing localStorage dataset in this phase.

## Resource model

The API stores each editable resource in its own PostgreSQL table. Related records use workspace-scoped composite foreign keys.

| API resource | PostgreSQL table | Important relation |
|---|---|---|
| `campaigns` | `campaigns` | Parent of briefs, tasks, content, expenses, KOLs and experiments |
| `briefs` | `briefs` | Optional campaign |
| `tasks` | `tasks` | Optional campaign |
| `contents` | `content_items` | Optional campaign |
| `expenses` | `budget_expenses` | Optional campaign |
| `kols` | `kols` | Optional campaign |
| `experiments` | `experiments` | Optional campaign |
| `competitors` | `competitors` | Parent of competitor posts |
| `competitor-posts` | `competitor_posts` | Required competitor |

Orders and advertising/social performance are deliberately not duplicated here. They remain in the normalized ingestion tables from migration 001.

## Authentication and tenant boundary

Every route requires the existing authenticated session or Bearer token and a valid `X-Workspace-Id` header.

The request runs inside `withWorkspaceContext`, which:
1. Starts a database transaction.
2. Sets transaction-local `nexus.user_id` and `nexus.workspace_id`.
3. Checks active workspace membership and resolves the role.
4. Executes the resource query under PostgreSQL RLS.
5. Commits the mutation and its audit event together.

Workspace roles `owner`, `admin`, and `member` may write. `viewer` is read-only. A resource or ID supplied by the client is never used as a SQL table name unless it matches the static resource registry.

## Endpoints

All paths are under `/api/v1/business-data`.

| Method | Path | Behavior |
|---|---|---|
| GET | `/:resource?limit=100&offset=0` | List records, newest updated first |
| POST | `/:resource` | Create a record using its existing client-generated ID |
| PATCH | `/:resource/:id` | Validate and update supplied fields |
| DELETE | `/:resource/:id` | Delete a record |

Supported `resource` values are listed in the resource model table. The list endpoint accepts `limit` 1–500 and `offset` 0–1,000,000. It returns `items` and `page: { limit, offset, hasMore }`.

Every returned item includes `version`, `createdAt`, and `systemUpdatedAt`. The API increments `version` on each update. Business date fields are calendar-date strings (`YYYY-MM-DD`); they are not interpreted in the browser's local timezone.

### Monetary and counter values

Money fields accept either non-negative safe integer JSON numbers or decimal strings with at most 16 integer digits and 2 decimal places. PostgreSQL stores them as `NUMERIC(18,2)`; API responses preserve them as decimal strings. Do not convert monetary strings to JavaScript floating-point values before calculations that require exactness.

Large counters accept non-negative safe integer numbers or integer strings and are stored as PostgreSQL `BIGINT`. Responses preserve the database value. Optional metrics remain absent when the source value is unknown; the API does not turn missing metrics into zero.

## Validation and lifecycle

- IDs are preserved so a later localStorage migration can retain existing record references.
- Unknown resource names and unknown update fields are rejected.
- Record IDs cannot be changed by PATCH.
- Campaign date ranges and experiment date ranges are validated.
- Cross-workspace campaign or competitor references fail at the database boundary.
- Deleting a campaign sets its optional references to NULL; deleting a competitor cascades its competitor posts.
- Create, update, and delete operations write an `audit_logs` event in the same transaction.
- Duplicate IDs return HTTP 409. Missing relationship references return HTTP 422. Invalid records return HTTP 400.

## Verification

The branch adds:
- `004_business_data.sql` with normalized tables, foreign keys, indexes, grants and workspace RLS.
- Route tests for creation, pagination, viewer write denial, database reference errors, patch validation, and resource allowlisting.
- PostgreSQL smoke checks for workspace-scoped business data reads/writes.

Run:

```bash
npm run db:migrate
npm run typecheck:server
npm run build:server
npm run test:server
```

The current frontend is not switched to this API yet. The following phase must add a safe localStorage export/import path, adapt client state to server responses and versions, and only then disable localStorage writes for migrated resources. Do not delete existing browser data as part of this API-only phase.
