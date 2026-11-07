# Testing NEXUS

## Commands

Run every automated test suite:

```bash
npm test
```

Run a single suite:

```bash
npm run test:server
npm run test:frontend
```

## Automatic test discovery

The test runner is `scripts/run-tests.mjs`. It recursively discovers files using these patterns:

- `*.test.ts`, `*.test.tsx`, `*.test.js`, `*.test.jsx`
- `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx`
- The corresponding `.mts`, `.cts`, `.mjs`, and `.cjs` variants.

Suite locations are deliberately scoped:

| Suite | Discovery root | Command |
|---|---|---|
| Backend | `server/test/` | `npm run test:server` |
| Frontend/data layer | `src/` | `npm run test:frontend` |

Add a matching test file beneath the relevant root. The runner discovers it automatically; do not maintain a second hand-written file list in `package.json`.

The runner exits with an error when a suite has no matching test files, so an accidentally empty test suite cannot pass silently.

## Database security checks

`server/test/db-rls.smoke.sql` is a PostgreSQL integration smoke test, not a Node test file. GitHub Actions runs it after applying migrations with separate migrator and runtime roles. It verifies workspace RLS behavior and workspace seat constraints.

## Continuous integration

The `NEXUS checks` workflow runs on pushes to branches and pull requests targeting `main` or `feat/**`. It performs:

1. `npm ci` from the committed lockfile.
2. PostgreSQL migrations and RLS smoke checks.
3. `npm audit --audit-level=high` (fails for high and critical vulnerabilities; lower severities remain visible in the audit output).
4. Frontend build and backend typecheck/build.
5. Backend and frontend test suites.

The lockfile is committed to the repository. CI must not generate or rewrite it.
