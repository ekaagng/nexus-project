# NEXUS — Marketing Intelligence & Operations PWA

**Implementation baseline:** PRD NEXUS v0.3 · Nocturne / Midnight Observatory

This repository contains an executable React + TypeScript + Vite PWA baseline. It implements the information architecture and major operational workflows with browser-local persistence and an offline app shell. It is intentionally marked **LOCAL DEMO BUILD** because the PRD leaves production authentication, hosting, database, AI provider, and external API contracts open.

## What is implemented

- Responsive Nocturne app shell: desktop sidebar, tablet/mobile navigation drawer, mobile bottom navigation, compact data density, safe-area spacing, focus states, and reduced-motion handling.
- All primary destinations from the PRD: Overview, Brief Library, Campaigns and Campaign Workspace, Budget Control, Tasks & Approvals, Content Calendar, Content Studio, Ads & Sales, KOL & Creators, Performance Analytics, Competitor Intelligence, AI Insight Lab, Reports & Exports, Integrations, Settings, and Owner-only Access Management UI.
- Local CRUD workflows for campaigns, briefs, tasks, content records, expenses, KOL profiles, orders, and competitor accounts. Task and content status transitions are editable.
- Campaign relationships using human-readable IDs (CAM, CNT, TSK, EXP, KOL), quick navigation to campaign context, and local activity/data summaries.
- CSV preview/import for orders and Ads records, sample templates in `templates/`, plus CSV exports.
- Local JSON backup and restore.
- Source-aware placeholders and explicit N/A states. Demo/sample records are labeled; actual sales are separated from Ads-attributed revenue.
- Context-aware assistant drawer with rule-based demo findings, evidence/data-gap labels, and action-item handoff. It does not pretend to be a connected AI model.
- PWA manifest, app icon, service worker app-shell/runtime caching, offline status, and last-known local data.
- Floating Back appears only in the multi-step campaign creation flow after step one; returning to the previous step preserves form state.
- Manual report preview with browser Print / Save as PDF. The production daily scheduler and Gmail delivery are explicitly not active.
- Asia/Jakarta calendar-date helpers for date ranges and form defaults; UTC timestamps remain ISO timestamps for audit fields.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). The service worker and installability should be tested on `localhost` or HTTPS. For a production bundle:

```bash
npm run build
npm run preview
```

## Demo behavior

The first launch seeds a clearly labeled sample workspace. Records are persisted in the current browser origin under localStorage key `nexus.workspace.v03`. Data is not shared between browsers or team members. Use **Settings → Local data backup** to export or restore the current browser's records.

The profile switch in the sidebar is a **visual role simulation only**. It is not authentication and does not enforce server security. Do not put real customer, KOL, financial, credentials, or order data into this local demo build.

## Important production gaps

See [`docs/PRODUCTION_GAPS.md`](docs/PRODUCTION_GAPS.md) for the PRD traceability matrix and the components that need a trusted backend before go-live. In particular, this build does not implement server-side allowlisting/session revocation, a shared database, official provider OAuth, Gmail delivery, Google Drive backup, server-side 00:00 WIB scheduling, push notifications, or a hosted AI model/RAG service.

## Project structure

```text
nexus-pwa/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/
│       ├── nexus.svg
│       ├── nexus-192.png
│       └── nexus-512.png
├── src/
│   ├── App.tsx          # application shell, navigation, pages and workflow interactions
│   ├── domain.ts        # domain models, local demo seed, IDs and formatters
│   ├── contracts/       # provider, AI evidence and report scheduling contracts
│   ├── main.tsx         # React entry point and service-worker registration
│   └── styles.css       # Nocturne design system and responsive layout
├── templates/            # CSV import templates
│   ├── ads-import-template.csv
│   └── orders-import-template.csv
└── docs/
    └── PRODUCTION_GAPS.md
```

## Design notes

- UI surfaces use layered translucency; tables and forms use a higher-opacity glass surface for readability.
- No remote fonts, icon CDNs, image CDNs, or external runtime assets are required.
- Charts are rendered as inline SVG to avoid chart dependencies in the offline shell.
- Motion uses opacity/transform; `prefers-reduced-motion` is respected.
- This is a frontend application baseline, not a deployed multi-user production service.
