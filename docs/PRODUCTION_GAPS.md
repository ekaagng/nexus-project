> **Backend foundation update (2026-11-03):** The initial v0.3 status matrix below describes the original frontend-only baseline. A partial backend foundation has since been added on `feat/data-integration-foundation`; see [DATA_INTEGRATION_FOUNDATION.md](DATA_INTEGRATION_FOUNDATION.md). PostgreSQL schema, OIDC verification boundary, tenant-scoped API routes, encrypted-token utility and sync-job metadata are present in that branch. This does not mean production authentication, provider OAuth, background workers or live dashboard reads are complete.

# NEXUS v0.3 — Implementation traceability & production gaps

## 1. Implemented in this baseline

| PRD area | Baseline implementation | State |
|---|---|---|
| Sections 7 / 11 — navigation and Nocturne UI | Overview, Phase 01–03, Workspace navigation; glass surfaces; information-dense dashboard; responsive sidebar/drawer/bottom nav | Implemented in frontend |
| Section 8.2 — Overview | KPI strip, trajectory chart, channel pulse, sales funnel, budget pacing, active campaigns, tasks, content radar, KOL pulse, intelligence, sync health | Demo/local data |
| Section 8.3 — Campaigns | Create campaign wizard, human-readable ID, status, objective, owner, dates, budget, channels, campaign workspace tabs | Local CRUD baseline |
| Section 8.4 — Briefs | Campaign/content/Ads/KOL brief template surfaces and brief records | Local create/read baseline |
| Section 8.5 — Tasks & approval | Task creation, kanban columns, status transitions, due dates, review state, campaign linking | Local CRUD baseline; approval actor/audit missing |
| Section 8.6 — Calendar | Month/week/list presentation from content, task deadlines, KOL collaboration records | Local view; calendar drag/reschedule not implemented |
| Section 8.7 — Content | Content creation, content pipeline status, platform/format/pillar/hook/CTA/owner/publish date, campaign relation | Local CRUD baseline |
| Section 8.8 — Ads | Ads metric table, CSV preview/import, KPI calculations with N/A on unavailable denominators | CSV/manual only |
| Section 8.9 — KOL | Creator database, Instagram URL field, rate, pipeline stage, campaign relation | Local CRUD baseline; deliverable/payment workflow partial |
| Section 8.10 — Sales | Order record entry, duplicate order ID check, CSV preview/import, paid/refunded status, revenue/AOV | Local baseline; provider reconciliation missing |
| Section 8.11 — Budget | Planned/committed/actual/remaining summaries, expense ledger, channel/category/campaign data | Local baseline; committed/actual validation partial |
| Section 8.12 — Reports | Report preview, JSON/CSV export, browser print-to-PDF | Manual; no scheduled delivery |
| Section 8.13 — Settings / notifications / audit | Workspace preferences, local notifications and visible activity cues; local data export/restore | Local-only; server audit, Gmail security alerts, push and encrypted credential management missing |
| Section 8.17 — Automated daily reporting | Daily report preview and printable snapshot; report contract defines prior-day WIB window and session-based recipient rule | Scheduler, server PDF renderer, Gmail OAuth/send, recipient evaluation and delivery log not active |
| Section 8.19 — Google Drive backup / restore | Local JSON export/restore is available as a prototype fallback | Drive OAuth, one-way encrypted backup, checksum, retention, restore drill and job log not implemented |
| Section 8.14 — Social analytics | Channel coverage and content metric display | UI/data model baseline only; official OAuth/API unavailable |
| Section 8.15 — Competitor Intelligence | Account list, public/manual observation records, public metric labels | Manual-only; no scraping or unofficial acquisition |
| Section 8.16 — AI Assistant | Page-aware assistant drawer, focus text, rule-based evidence/data-gap output, action handoff | Rule-based demo; no LLM/RAG |
| Section 8.18 — Access Management | Owner-only navigation visibility and page UI in demo role state | Visual simulation only; not a security boundary |
| Section 13 — PWA | Manifest, app icon, service worker shell/runtime cache, offline indicator, local last-known records | Implemented for frontend baseline |
| Section 11.9 — Floating Back | Two-step campaign wizard with persistent form state and previous-step label | Implemented |
| Section 11.10 — Contextual AI | Launcher is available across pages and panel reflects current page/phase context | Implemented as demo shell |

## 2. Must be implemented in backend before real team use

### Identity, sessions and access governance

- Choose and configure the production login method (Google OAuth, password, magic link, or combination). The PRD has not finalized this.
- Implement a server-owned allowlist table with one immutable initial Owner and at most four Members.
- Enforce closed registration, workspace membership, Owner-only Access Management, Owner-only invite/revoke, and seat count in backend handlers and database policies.
- Implement opaque server sessions, expiry, rotation, CSRF protections, logout, revoke-all-user-sessions, and session revalidation on every protected request.
- Add audit events for login, invalid access, allowlist changes, role changes, session revoke, and security anomaly.
- Define granular Member permissions beyond the confirmed Access Management restriction.

### Database and domain API

- Move workspace, user/membership, campaigns, briefs, tasks, approvals, comments, attachments, contents, social snapshots, Ads records, KOL collaborations/deliverables, orders, budget ledger, imports, sync jobs, audit logs, reports, notifications, AI analyses, and backups into a shared server database.
- Apply `workspace_id` scoping to every query and export; add database-level policies and cross-workspace authorization tests.
- Implement soft delete, pagination, server-side filtering, idempotency keys, external ID uniqueness, validation, concurrency controls, and transaction-safe budget/order updates.
- Keep local browser cache as read-only last-known snapshot or limited draft queue. Do not treat localStorage as shared or authoritative.

### Connectors

- Implement Meta Ads, Scalev and Lynk.id through verified official API contracts and least-privilege scopes. Target refresh is 10–15 minutes when provider quotas permit.
- Implement Instagram, TikTok and YouTube official OAuth/API access for connected workspace-owned accounts. Show only supported metrics and preserve platform-specific metric definitions.
- Implement OAuth/token refresh and encrypt access/refresh tokens server-side. Never return stored tokens to the browser.
- Build queue/worker jobs with incremental sync, backoff/retry, rate-limit handling, deduplication, import history and last-successful-sync metadata.
- Keep CSV/manual fallback. Do not use unofficial scraping, private endpoints or access-control bypass for competitor data.
- Define the source of truth and refund/cancel reconciliation for Scalev and Lynk.id before combining sales figures.

### AI and intelligence

- Select the AI deployment/provider and approve privacy/data retention requirements.
- Implement retrieval over authorized campaign, brief, content, performance, sales, experiment and decision records.
- Attach evidence references to all factual claims. Keep evidence, interpretation, hypothesis, recommendation, validation metric and data gaps separate.
- Store user feedback and experiment outcomes without silently training/fine-tuning a model.
- Gate operational writes behind explicit user permission and confirmation.

### Reporting, Gmail and backups

- Implement a server-side scheduler for 00:00 Asia/Jakarta (UTC 17:00) that produces the prior calendar day's report, 00:00:00–23:59:59 WIB.
- Use a unique workspace + period report key. Keep generation/delivery logs, recipient snapshot, message reference, retry count and error for idempotency.
- Evaluate recipients at send time from non-expired, non-revoked server sessions. Do not use a manually maintained recipient list. If there are no eligible sessions, archive the PDF and mark `skipped_no_active_session`.
- Connect Gmail through OAuth/API and send the report PDF; a numeric report must still be generated if AI generation fails.
- Implement one-way Google Drive backup for selected database/files, encryption in transit and at rest, checksums, retention, job logs, and a tested restore workflow.
- Schedule backup cadence/retention and define Drive account/folder with Owner during deployment.

### Operations and non-functional controls

- Add server-side monitoring, structured logs, alerting, error tracking, backups, restore drills and production secrets management.
- Add integration, unit, access-control, CSV, deduplication, report scheduling, PWA offline, and responsive visual tests.
- Validate WCAG 2.2 AA, keyboard focus, screen-reader labels, 320/360/390/768/1024/1440/1920 viewport matrix, and installed PWA behavior on real devices.
- Perform security review, dependency audit, penetration testing, data retention review and privacy notice before storing real business/customer data.

## 3. Explicit production status

| Capability | Current state |
|---|---|
| Shared multi-user workspace | Not implemented — browser-local data only |
| Real login / allowlist / session revoke | Not implemented — role switch is UI simulation |
| Backend database and workspace isolation | Not implemented |
| Official Meta/Scalev/Lynk/social API integrations | Not connected |
| Scheduled 00:00 WIB PDF + Gmail delivery | Not implemented — manual browser print only |
| Google Drive backup/restore | Not implemented — local JSON export/restore only |
| AI model + historical RAG | Not implemented — local rule-based demo only |
| Push notifications | Not implemented — in-app notification sample only |
| Competitor insights | Manual public observations only; no private metrics or scraping |

## 4. Deployment decision required

The PRD explicitly leaves frontend/backend architecture, database, hosting, queue, AI provider, auth method and provider-specific contracts open. This baseline does not silently choose these production vendors. Before connecting credentials or deploying to a shared workspace, select those decisions and implement the controls listed above.
