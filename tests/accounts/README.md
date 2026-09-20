# Local account integration tests

Run `npm run test:accounts`. Playwright applies the real D1 migrations, builds the
application, then starts **local** Cloudflare Pages on `127.0.0.1:8789`. Both
migrations and the server use `.wrangler/test-accounts`, separate from normal
Wrangler persistence. No remote database or deployed service is used, and an
existing server is never reused. The readiness URL is `/api/health`, which checks
the required database columns before tests start.

A second local Pages server on `127.0.0.1:8790` uses a fresh, run-specific
`.wrangler/test-accounts-lifecycle/<uuid>` directory. Its lifecycle test first
checks missing-schema 503 responses, then migrates **only that database** and
expires one synthetic session by its owner ID and token hash. Neither the shared
account-test database nor normal development persistence is modified by these
fixtures. The static root, not `/api/health`, starts this intentionally unready
server. Both servers share the same build.

The API project uses real HTTP, D1 transactions, sessions, and native scrypt.
Accounts and simulated `CF-Connecting-IP` addresses are unique per test so
authentication limits do not leak between tests or repeated runs. Dedicated
throttling tests deliberately reuse an IP or username; write throttling is
tested per account. Tests run in one worker, with explicit concurrent requests
where a race is part of the assertion.

The Chromium project covers account access before policy setup, sign-in/out,
cross-browser persistence, account switching, and explicit local-data import.
Lifecycle checks cover offline pending-edit export/retry, service-worker API
navigation exclusions, absence of private data from browser caches and storage,
and logout broadcasts clearing other tabs and private drafts.
Only client clocks are fixed; server session expiration and rate limits use real
time. Local IndexedDB is checked before and after account operations. No API is
mocked.

Focused runs:

```sh
npm run test:accounts -- --project=accounts-api
npm run test:accounts -- --project=accounts-chromium
npm run test:accounts -- --grep 'lifecycle:'
```

The guest-only `playwright.config.ts` excludes this directory. Account test
artifacts are written to `test-results/accounts`; local test data remains in the
ignored `.wrangler/test-accounts` and `.wrangler/test-accounts-lifecycle`
directories for diagnosis.
