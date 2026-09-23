# RTO Planner

A private, local-first return-to-office tracker built from
[`web-feature-specification.md`](web-feature-specification.md). The React/TypeScript
application lives at the repository root. The local planner works without an account.
Optional username/password accounts use **Cloudflare Workers and D1** for a
separate cross-device planner. A Pages Functions configuration remains available
for optional Pages deployments. There are no analytics.

## Run locally

Use the Node version in `.node-version`.

```sh
npm ci
npm run db:local
npm run cf:dev
```

Open `http://localhost:8788`. This runs the Worker, the built PWA, and a
**local** D1 database; it does not access production. For Vite hot reload, leave
Wrangler running and use a second terminal:

```sh
npm run dev
```

Vite proxies `/api` to the Worker on port 8788. Without Wrangler, the local
planner still works but reports that account connectivity is unavailable.
Confirm a policy on the first visit, or restore a versioned JSON backup. The
default best-8-of-12 average / 3-day policy is an unconfirmed example until you
explicitly accept it. New planners start weeks on Sunday; existing policies keep
their saved week start.

```sh
npm test                 # Pure domain, storage, migration, and backup tests
npm run build            # Strict TypeScript and production PWA build
npx playwright install   # Browser runtimes, once
npm run test:e2e          # Builds and serves the production app for browser journeys
npm run test:accounts     # Real local Pages + isolated D1 account/API/browser journeys
```

To try offline support locally, use `npm run build && npm run preview` rather
than the development server. Preview serves only static assets, not account APIs.
Visit once online and wait for "Ready for offline use" before disconnecting.
Installation is optional. **Account storage requires a connection**; only the
local planner supports offline persistence.

## Cloudflare deployment

The default `wrangler.jsonc` targets **Workers with Static Assets**, matching
Ensemble and Cloudflare Workers Builds. `server/worker.ts` sends `/api` to the
account handler before the SPA fallback. Production binds `DB` to the dedicated
`rto-planner` database, not Ensemble's database.

Use these Cloudflare Workers Builds settings:

| Setting | Value |
| --- | --- |
| Root directory | `/` or blank |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Node version | `22.19.0` (also pinned in `.node-version`) |
| Dependencies | `npm ci` using committed `package-lock.json` |

`npm run deploy` runs `wrangler deploy`. The Workers Builds token therefore
needs Workers Scripts edit access, not Pages edit access. A token that can run
`wrangler whoami` but lacks the target product's edit permission is not sufficient.

`cloudflare-pages/wrangler.jsonc` is the optional Pages configuration. It binds
production to `rto-planner` and Pages previews to the separate
`rto-planner-preview` database. For a separately created Pages Git-integration
project, use:

| Setting | Value |
| --- | --- |
| Root directory | `/` or blank |
| Build command | `npm run build` |
| Output directory | `dist` |
| Deploy command | Blank; Pages Git integration deploys automatically |
| Node version | `22.19.0` (also pinned in `.node-version`) |
| Dependencies | `npm ci` using committed `package-lock.json` |

The optional `officedaystracker` Pages project uses direct upload. Cloudflare does
not let a direct-upload project switch to native Git integration later; use a
Pages-capable CI token for automated direct uploads, or create a separate
Git-integrated Pages project. For the default Worker release:

```sh
npx wrangler whoami
npx wrangler d1 info rto-planner
npx wrangler d1 migrations list DB --remote
npm run db:remote
npm run build
npm run deploy
```

**Creating a database or deploying code does not create its tables.** Migrations
are an explicit, separately authorized release step. The initial migration
creates `users`, `sessions`, `rate_limits`, and `planners` atomically. Verify
without reading user records:

```sh
npx wrangler d1 migrations list DB --remote
npx wrangler d1 execute DB --remote \
  --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
curl --fail https://officedaystracker.robert-k-lee.workers.dev/api/health
```

`/api/health` queries every required table/column and returns JSON `503` if the
binding or schema is missing. It is a readiness check, not proof that passwords,
cookies and planner writes work. Exercise actual signup/login/save/logout with
disposable accounts **only in isolated staging**. The existing optional Pages
preview path is:

```sh
npm run db:preview
npm run build
npm run deploy:pages -- --branch account-staging
```

The preview alias is `https://account-staging.officedaystracker.pages.dev`.
All preview branches share the configured preview database, not production.
Do not deploy untrusted code with access to either real-user data or deployment
credentials. Use another Pages project/database for untrusted previews.
Other installations must create their own Worker or Pages project and D1
databases, replace the database IDs, and apply each database's migrations.

`npm run deploy:pages` uses `wrangler pages deploy` and requires Pages edit
permission. The default `npm run deploy` deliberately uses `wrangler deploy`,
which is compatible with the existing Workers Builds token. Migration credentials
also require D1 edit permission. Keep `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in CI secrets, never Vite.
GitHub Actions runs quality gates but does not deploy or migrate remote data.
Do not change hosting or DNS without planning a stable-origin data transfer.

Keep the configured SPA fallback: **do not add a top-level `404.html`**.
The router handles `/dashboard`, `/calendar`, `/settings`, `/account`, and unknown routes.
The Worker's `run_worker_first` setting sends `/api` and `/api/*` through
`server/worker.ts`; unknown API paths return JSON, not the SPA shell. Optional
Pages deployments use `public/_routes.json` and
`cloudflare-pages/functions/api/[[path]].ts`.
`public/_headers` supplies a same-origin CSP, anti-framing policy, MIME protection,
referrer policy, and disabled camera/microphone/location permissions. All fonts,
scripts, styles, and PWA assets are local. Cloudflare receives ordinary request
metadata; this is not a promise that visits are invisible.

Choose a stable production origin. A custom domain, `workers.dev`, `pages.dev`, previews,
and local development each have a separate IndexedDB. Transfer records between
origins with JSON export/import, not automatic migration. A new Pages address
cannot access records stored on the old Worker address. Use only synthetic data
in previews.

## Accounts, data boundaries and operations

Visit **Account** to sign up, sign in, or sign out. Usernames are normalized to
lowercase (3-30 ASCII letters, numbers or underscores), display names are 1-60
characters, and passwords are 12-200 characters with no trimming/truncation.
Account creation is transactional: user, session, and empty planner succeed
together. **Local records are never uploaded automatically.** After signing in,
review the local-data import or restore a JSON backup in Settings. Both operations
replace only the account planner after confirmation and preserve the local original.

Local data remains in the original `rto-planner` IndexedDB. Account data stays in
D1 and in the active page's memory only, not IndexedDB/localStorage/Cache Storage.
Passwords and session tokens are never persisted by application JavaScript.
Signout revokes the presented session and remounts the local workspace, clearing
account data, drafts and undo history; other tabs receive a broadcast to clear
their account workspace too. Every planner request includes the expected account
ID, checked against the cookie session, so stale tabs cannot write to a newly
signed-in account. All reads/writes are scoped by the server-authenticated user ID.

Cloud updates are read on focus and every 30 seconds while no edit is pending.
The same shared action reducer implements local and cloud revision conflicts,
per-date tombstones, generation invalidation, atomic replacement and undo.
D1 uses compare-and-swap writes; concurrent independent-date edits can succeed,
while stale same-date edits are rejected, not silently overwritten. The latest
mutation ID and result are retained for retry after a dropped response; once a
later mutation supersedes it, a stale retry may require refresh/review instead.
Failed edits can be exported before discarding. No offline cloud-write queue or
automatic merge is provided. The account limit is **1.5 MB including revision
and last-undo metadata** (below D1's row limit); the existing 5 MB local backup
import limit is unchanged.

Passwords use native Workers `node:crypto.scrypt` with versioned
`N=16384, r=8, p=5`, a random 16-byte salt, a 32-byte derived key, and
`timingSafeEqual` verification. This is the
[OWASP 16 MiB scrypt profile](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt);
nonexistent users perform the same derivation. Hash version/parameters are stored
with each hash; unsupported versions fail explicitly. Future work-factor changes
must add version-aware verification and upgrade hashes after successful login.
Benchmark real staging authentication on the intended Cloudflare plan; a local
test or build cannot establish production CPU capacity. Do not weaken hashing
to meet a free-tier CPU limit.

Sessions use random 32-byte tokens, with only SHA-256 token digests in D1.
The host-only cookie is `HttpOnly; Secure; SameSite=Strict; Path=/` and expires
after 30 days (only loopback HTTP omits `Secure`). Exact same-origin `Origin`
headers and JSON are required for mutations; bodies and stored data are bounded.
All API responses, including errors, are `no-store`, and the service worker never
caches `/api` requests or API navigations.

Database-backed limits are signup 5/IP/hour, login 20/IP/15 minutes, combined
authentication 10/username/15 minutes, and planner writes 120/account/minute.
IP/username rate keys are hashed. Expired sessions and rate keys are incrementally
deleted in batches of 100 on authentication and planner writes; an idle service
retains expired rows until the next such request, but expired sessions never
authorize access. Large public deployments need edge-level abuse controls and
monitoring in addition to these application limits.

**Unsupported:** password reset/recovery, email verification, MFA, changing
credentials, a session-management screen, and self-service account deletion.
No email is collected and a forgotten password cannot be recovered. Future
credential-change flows must revoke **all** of the user's sessions. Treat account
mode as a basic personal service, not a complete public identity platform.

**Retention and deletion:** account data is retained until explicitly erased;
there is no inactivity purge. Settings erases the account planner but not the user
or other sessions. An operator must verify ownership out of band before deleting
a specific user's row; foreign keys cascade to sessions/planner. Never identify
an account to delete solely from a claimed username, and never delete real
production users in a smoke test. Deleted data may remain in D1 recovery history
for the configured retention period.

**Backups and recovery:** keep user-exported JSON backups and configure/verify
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
retention for the account's Cloudflare plan. Test an operator-led restore on a
separate database before using it during an incident; restoring an entire
database can restore previously revoked sessions, so invalidate sessions after
a recovery. There is no app-managed scheduled backup or automated restore.
Account records are not end-to-end encrypted. Logs deliberately exclude
credentials, cookies, tokens, request bodies and attendance.

## Behavior and architecture

The interface uses a shared neutral-and-blue color system in `src/styles.css`,
local SVG icons, and system fonts. Desktop navigation sits in the header; mobile
navigation stays within thumb reach at the bottom. Controls retain visible keyboard
focus, 44px touch targets, and reduced-motion support.

- **This week** (`/dashboard`): quick entry for all seven days, office/remote/time-off
  tools, clear and undo, logged/planned totals, and a recommended office-day count.
  Browse previous or next weeks, or return with **This week**. Past weeks show
  logged attendance; future weeks show recommendations within the forecast window.
  Weeks beyond that window remain editable without a recommended target.
  The next six weeks appear as **Needed** or **Flexible** cards with suggested
  office-day counts; selecting a card opens that week. The full outlook shows
  the minimum days needed in each week and marks guidance conditional while
  future days are unplanned. The planner favors the policy's weekly frequency
  and suggests extra days only when the forecast needs them.
  Past and present entries are logged; future entries are plans. Editing protected
  days requires confirmation. Completed-week results and a collapsed weekly outlook
  sit below the entry controls.
- **Calendar:** idempotent painting; Office, Remote, leave types and Clear;
  inclusive/reverse range painting; optional weekends; keyboard ranges; notes;
  actual/planned status; protected commitments; and transactional undo. Each day
  type has a distinct color and label; planned days have dashed borders and badges.
  Touch swipes scroll without painting; taps edit one day, and mouse drags paint ranges.
- **Settings:** typed policy validation and recalculation preview; fixed IANA
  timezone; complete JSON backups; attendance-only CSV; reviewed atomic import;
  explicit local/account-planner deletion; and local persistent-storage requests.
- **New policy defaults:** the start date is a complete reporting window before
  the current policy-local week (12 weeks for the suggested rolling policy).
  Changing the policy, window, week start, or timezone updates the suggested
  date until the user edits it. Existing policies keep their saved start dates.
  Unlogged past weeks can count as missed; setup warns before confirmation.
- **Account:** signup/login/logout, cross-device planner persistence, explicit
  local-data import, and account/local separation.

`src/domain/` contains pure, reference-date-driven civil-date, policy, projection,
and planning modules. The typed `PolicyFormula` registry provides validation,
evaluation, explanation, and recommendation metadata; it does not execute
uploaded expressions. Weekly guidance starts from a feasible cap near the policy frequency,
increasing it only when necessary, then removes later unneeded dates while
preserving every checkpoint. It preserves commitments, favors fewer additions
and earlier dates, and is locally minimal, **not globally optimal**. The search
runs automatically in a worker and returns weekly totals, not specific dates
to attend. Totals include existing office entries; recommendations never write
attendance or apply a schedule.
Required-weekday policies still require their configured weekdays. Results refresh
after edits and policy-local date changes; outdated worker results are discarded.
If the search cannot satisfy the forecast, the UI asks for a plan review rather
than showing a misleading zero-day target.

`src/data/model.ts` contains the shared mutation rules; `repository.ts` is the
Dexie transaction boundary and `remote-repository.ts` calls the account API.
Each date has a revision, including
deletion tombstones, and dataset replacement advances a generation. Stale edits
are rejected rather than overwritten. Dexie live queries propagate same-origin tab changes. Failed edits
remain available for retry or a recovery JSON export. Undo is session-local (last
30 attendance actions), checks revisions, and does not survive reload or import.

Database version 2 migrates version-1 records to revisioned rows transactionally.
Invalid migration input aborts without removing the previous database. Older
connections close on version change and the UI requests reload; migrations must
remain compatible with deployed assets. Asset rollback does not roll back data.

Civil dates use `Temporal.PlainDate` and never local-midnight timestamps.
Today comes from the persisted policy timezone and refreshes on focus and every
15 seconds. Recorded office days can earn credit on any day, including weekends.
Midweek enforcement starts formal evaluation the next full policy week. Leave does not lower targets. Rolling
initialization uses the disclosed scaled target; current-week progress is never
formal completed-week compliance. Plans are never silently confirmed.

The forecast covers the current policy week **plus the next max(12, window)
weeks**. Unknown future dates are capacity, not remote records. Actual future
records imported from a backup are excluded from history and are not silently
promoted into plans. Past plans require confirmation. A protected conflict does
not lower the policy requirement. The app cannot certify an employer's policy.

## Release evidence and remaining external gates

The automated suites cover independently specified rolling/average/weekly/
weekday fixtures, week-start boundaries, DST-safe dates, initialization,
qualifying-week expiry, immutable plans, preservation of protected/leave dates,
full-horizon suggestion verification, same-count edits, stale-tab conflicts,
atomic quota failure, backups, migration success/failure, calendar painting and
keyboard alternatives, 320px reflow, offline reload and exports.

The account suite runs against real local Pages Functions and an isolated D1
database, covering credentials, session cookies, owner isolation, CSRF rejection,
input/body limits, throttling, cloud revision conflicts and reviewed local import.
On September 20, 2026, the separate staging Pages deployment also completed
HTTPS signup, policy and attendance saves, reload, login in an independent
browser, and signout/revocation. Both remote schemas were migrated and inspected;
only disposable preview accounts were used and were removed afterward.
Production readiness, API routing, security headers and the account UI were
checked without creating production user records. These checks do not cover
unsupported account recovery or replace the physical-device gates below.

A measured local baseline on macOS ARM64 with Chromium `153.0.8010.12` used
1,827 daily records and a 52-week horizon. Both desktop and Pixel 7 emulation
recorded 64 ms for a saved edit plus dashboard/forecast recalculation and 3 ms
for calendar range feedback. These are automated, unthrottled host measurements,
**not measurements from a physical phone**. The browser tests enforce the
500 ms / 100 ms budgets and attach per-run measurements. A local two-version
service-worker fixture also exercises the real update prompt while a notes
draft is open, then verifies saved attendance after the confirmed reload.

Playwright uses Chromium, Firefox, WebKit, and mobile Chromium emulation.
Emulation and bundled engines are **not** evidence of complete support for both
current and previous stable Safari/iOS, Chrome, Edge, and Firefox releases.
Before a public release:

1. Test on physical mobile devices and actual supported browser versions,
   including VoiceOver/NVDA, touch scrolling/cancellation, and reduced motion.
   Record the device/browser and verify <=100 ms interaction feedback and
   <=500 ms forecast recalculation with five years of records and a 52-week
   horizon. The domain suite enforces the forecast budget on its host machine,
   not a physical phone.
2. On a synthetic-data Pages preview, reload each route, inspect the deployed
   security headers, cache the shell and start offline, save/export offline,
   then deploy an asset update. Verify the update prompt never forces a reload
   during editing, and verify older-tab migration behavior before activating
   any new schema. Playwright WebKit's offline inspection is not a substitute
   for a real iOS/Safari offline test.
3. Smoke-test the stable production origin separately without synthetic writes
   to production. Confirm preview D1 is isolated, API readiness and deployed
   bindings are correct, and guest mode never transmits attendance or notes.
   Exercise real signup/login/save/logout and HTTPS cookies in staging, including
   browser reload, another device, account switching and offline failures.
   Verify manual backup transfer before changing domains.

There are no scheduled notifications when the site is closed. Native-data imports,
employer-specific leave exemptions and historical policy versions remain out of scope.
