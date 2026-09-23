# Repository guidance

This is a local-first return-to-office planner built with React, TypeScript,
Vite, Vitest, Playwright, Dexie, and optional Cloudflare Workers/D1 accounts.
Read `README.md` for product behavior, data boundaries, and deployment details;
use `.node-version` and the scripts in `package.json`.

## Where to work

- `src/domain/`: pure civil-date, policy, projection, and planning logic. Pass
  reference dates explicitly; use `Temporal.PlainDate` rather than timestamps
  for calendar days. Keep policy calculations independent of the UI and storage.
- `src/app/`: routing, state, and the planning worker. Discard stale worker
  responses when data or the policy-local date changes.
- `src/data/`: shared mutation rules, local Dexie storage, and the remote
  account repository. Keep local and remote mutation semantics aligned;
  protect against stale writes and lost updates, including deletes and undo.
- `src/features/`, `src/components/`, `src/styles.css`: screens, reusable
  controls, and the shared visual system. Keep keyboard, touch, small-screen,
  and reduced-motion behavior usable. Write brief, plain-language UI copy.
- `server/`, `migrations/`: Worker API, authentication, and D1 schema.
  `cloudflare-pages/` is the optional Pages deployment path. Keep their API
  behavior consistent.
- `src/**/*.test.ts`: unit tests; `tests/*.spec.ts`: guest browser journeys;
  `tests/accounts/`: local Pages/D1 integration tests (see its README).

## Behavior and data boundaries

- Consult `README.md` and tests for current policy defaults, week navigation,
  and attendance guidance. Change product behavior deliberately and update
  the relevant tests and documentation; do not treat current defaults as
  permanent requirements.
- Use the saved policy timezone for "today". Distinguish unknown future dates,
  saved plans, and recorded attendance; recommendations must not write entries.
  Surface infeasible guidance as a conflict rather than a plausible-looking
  target.
- Keep local and account data separate. Never upload local records without
  explicit user action and confirmation. Changes to where private account
  data is stored require deliberate privacy review and regression tests.
- Preserve account isolation and security controls when changing authentication,
  API validation, or persistence. Do not log credentials, tokens, attendance,
  or notes.

## Workflows

```sh
npm test                 # Unit tests
npm run build            # TypeScript checks and production build
npm run test:e2e         # Guest browser tests; builds and serves the app
npm run test:accounts    # Real local Pages/D1 account integration tests
```

For focused changes, run relevant Vitest files or Playwright tests first;
include broader suites when changing shared policy, persistence, routing, or
account behavior. Add regression coverage for policy boundaries, week starts,
timezones, planned versus actual entries, and storage conflicts as applicable.
Browser test servers and their ports are defined in the Playwright configs.

For local API development, run `npm run db:local` then `npm run cf:dev` (local
D1 and Worker on port 8788); `npm run dev` starts Vite with `/api` proxied to
the Worker. Vite alone supports the local planner but not account APIs.
Update `README.md` when user-facing behavior or operational steps change.

Do not run remote D1 migrations, deploy, alter DNS, or touch production data
without explicit authorization. `npm run db:remote`, `npm run db:preview`,
`npm run deploy`, and `npm run deploy:pages` affect remote services; local
tests should use the isolated test databases. Never commit secrets or real
user data.
