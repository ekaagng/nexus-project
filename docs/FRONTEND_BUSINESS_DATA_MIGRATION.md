# NEXUS — Frontend Business Data Migration

**Branch:** `feat/frontend-business-data-integration`  
**Base:** `feat/business-data-api`  
**Scope:** connect the React workspace UI to the workspace-scoped Business Data API and migrate existing browser records without deleting the original snapshot.

## Data ownership

| Data | Source of truth | Current frontend behavior |
|---|---|---|
| Campaigns | PostgreSQL | API read / create / update / delete |
| Briefs | PostgreSQL | API read / create / update / delete |
| Tasks | PostgreSQL | API read / create / update / delete |
| Content items | PostgreSQL | API read / create / update / delete |
| Budget expenses | PostgreSQL | API read / create / update / delete |
| KOLs | PostgreSQL | API read / create / update / delete |
| Experiments | PostgreSQL | API read / create / update |
| Competitors | PostgreSQL | API read / create / delete |
| Competitor posts | PostgreSQL | API read / create / delete with competitor removal |
| Orders | Browser-local | Preserved in the browser snapshot; CSV/manual edits remain local |
| Ads metrics | Browser-local | Preserved in the browser snapshot; CSV import remains local |
| Notifications | Browser-local | Ephemeral local workspace state |

The UI does not send OIDC tokens, connector credentials, or other secrets to localStorage. The API uses the current authenticated session, `X-Workspace-Id`, workspace role checks, and PostgreSQL RLS.

## One-time migration flow

When a workspace is opened:

1. Read its old key: `nexus.workspace.v03:<workspace-id>`.
2. Parse the existing snapshot. Invalid JSON or an invalid collection shape stops the migration; the old key is not overwritten.
3. Import missing business records through authenticated API POST routes. Parent records are imported before their dependants.
4. Before each resource import, read existing server IDs and skip records already present. If a concurrent import causes a 409, re-read the collection and skip only when that ID exists.
5. Save the browser-only subset to `<old-key>:local-v1`.
6. Write `<old-key>:business-api-v1` only after all imports complete.
7. Load all nine business-data collections from PostgreSQL and combine them with browser-only orders, Ads, and notifications.

A failed/partial import leaves the original browser snapshot intact and does not write the migration marker. Retrying is safe: IDs that were already imported are skipped. The migration does not overwrite an existing server record with an older browser copy.

### Browser storage keys

- `nexus.workspace.v03:<workspace-id>`: original legacy snapshot, deliberately retained as a read-only recovery copy.
- `nexus.workspace.v03:<workspace-id>:local-v1`: browser-only orders, Ads metrics, notifications, and local updated timestamp.
- `nexus.workspace.v03:<workspace-id>:business-api-v1`: migration completion marker and import counts; it contains no business records.

The old snapshot is not deleted by migration or by ordinary CRUD operations.

## Runtime behavior

- Business collection reads use the API with bounded pagination.
- Business collection writes are serialized in the frontend and sent to POST/PATCH/DELETE endpoints before React state is committed.
- If an API write fails, the UI does not commit that change locally and shows an error toast.
- `viewer` write restrictions are enforced by the backend, not trusted to the frontend.
- Orders and Ads remain browser-local until their normalized API contracts and manual transaction workflow are implemented. They are explicitly identified as browser-local in the workspace status banner.
- The current implementation requires an API connection for business-data writes. It does not provide an offline write queue or conflict-resolution UI.

## Backup and restore

- JSON export includes the currently loaded server business records plus browser-local orders, Ads, and notifications.
- Restore reconciles all nine business collections through the API, deleting dependants before parents and writing parents before dependants. Browser-only records are stored in the local cache after the server update succeeds.
- Reset-to-demo is a destructive workspace operation and requires confirmation because it affects all workspace members.
- The original migration snapshot remains in its old key even after a restore.

## Frontend/backend contract boundary

UI-only changes (layout, typography, navigation, chart design, component composition) do not require backend changes.

Backend coordination is required when a change alters:
- API resource names or paths;
- field names, data types, required/optional rules, or validation constraints;
- relationships and deletion behavior;
- monetary precision, counter representation, or data ownership.

Keep API contracts in the data adapter layer rather than defining backend field behavior inside React components. Add backward-compatible fields or migration scripts on the backend before changing frontend code that depends on them.

## Verification

Run:

```bash
npm run typecheck
npm run build
npm run test:server
```

The CI workflow also applies migrations 001–004, runs PostgreSQL RLS smoke checks, builds the frontend and backend, and executes the server plus frontend mapping tests.

## Known boundary

This is not yet a live third-party integration release. Provider OAuth/adapters and sync workers remain separate work. It also does not move the browser-local Orders and Ads collections to the PostgreSQL ingestion tables; doing so requires an explicit normalized mapping, source lineage, and reconciliation rules.
