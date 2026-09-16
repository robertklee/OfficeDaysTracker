# RTO Planner

A private, local-first return-to-office tracker built from
[`web-feature-specification.md`](web-feature-specification.md). The React/TypeScript
application lives at the repository root. No native app files, attendance backend, accounts,
analytics, or cloud database are required.

## Run locally

Use the Node version in `.node-version`.

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Confirm a policy on the first visit, or restore
a versioned JSON backup. The default best-8-of-12 average / 3-day policy is an
unconfirmed example until you explicitly accept it.

```sh
npm test                 # Pure domain, storage, migration, and backup tests
npm run build            # Strict TypeScript and production PWA build
npx playwright install   # Browser runtimes, once
npm run test:e2e          # Builds and serves the production app for browser journeys
```

To try offline support locally, use `npm run build && npm run preview` rather
than the development server. Visit once online and wait for "Ready for offline
use" before disconnecting. Installation is optional.

## Cloudflare deployment

The checked-in configuration targets **Cloudflare Workers Static Assets**, which
matches Cloudflare's pipeline with separate build and deploy commands:

| Setting | Value |
| --- | --- |
| Root directory | `/` or blank |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Node version | `22.19.0` (also pinned in `.node-version`) |
| Dependencies | `npm ci` using committed `package-lock.json` |

`npm run deploy` runs the pinned `wrangler deploy`. `wrangler.jsonc` publishes
`dist` as static assets and routes unknown paths to the SPA entry point. It has
no Worker script, Functions, D1, secrets, server-side attendance processing, or
Vite environment secrets. This avoids calling the Pages API from a Workers build
token, which otherwise fails with authentication code 10000.

For a separate **Pages Git integration** project, use build command
`npm run build`, output directory `dist`, and leave the deploy command blank;
Pages publishes the output itself. Do not run `wrangler pages deploy` from a
Workers build unless its custom token has Cloudflare Pages edit permission.

Keep the configured SPA fallback: **do not add a top-level `404.html`**.
The router handles `/dashboard`, `/calendar`, `/settings`, and unknown routes.
`public/_headers` supplies a same-origin CSP, anti-framing policy, MIME protection,
referrer policy, and disabled camera/microphone/location permissions. All fonts,
scripts, styles, and PWA assets are local. Cloudflare receives ordinary request
metadata; this is not a promise that visits are invisible.

Choose a stable production origin. A custom domain, `workers.dev`, `pages.dev`, previews,
and local development each have a separate IndexedDB. Transfer records between
origins with JSON export/import, not automatic migration. Use only synthetic data
in previews. GitHub Actions runs the local quality gates but does not deploy.

## Behavior and architecture

- **Calendar:** idempotent painting; Office, Remote, leave types and Eraser;
  inclusive/reverse range painting; optional weekends; keyboard ranges; notes;
  actual/planned status; protected commitments; and transactional undo.
- **Dashboard:** completed-week results, current-week progress, two explicit
  forecast cases, first affected checkpoint, expiring qualifying weeks, past-plan
  reminders, strategic week labels, and reviewed/undoable schedule suggestions.
- **Settings:** typed policy validation and recalculation preview; fixed IANA
  timezone; complete JSON backups; attendance-only CSV; reviewed atomic import;
  explicit local deletion; and persistent-storage requests.

`src/domain/` contains pure, reference-date-driven civil-date, policy, projection,
and planning modules. The typed `PolicyFormula` registry provides validation,
evaluation, explanation, and recommendation metadata; it does not execute
uploaded expressions. The planner starts from a proven feasible capacity
schedule and removes later dates when all checkpoints remain satisfied. It
preserves commitments, favors fewer additions and earlier dates, and is locally
minimal, **not globally optimal**. The search runs in a worker so calendar and
navigation interaction are not blocked.

`src/data/` is the Dexie transaction boundary. Each date has a revision, including
deletion tombstones, and dataset replacement advances a generation. Stale edits
are rejected rather than overwritten; full-plan previews also check the dataset
revision. Dexie live queries propagate same-origin tab changes. Failed edits
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
3. Smoke-test the stable production origin separately. Confirm preview data is
   isolated and that network requests contain only application resources, never
   attendance or notes. Verify manual backup transfer before changing domains.

There are no scheduled notifications when the site is closed. Accounts,
cross-device sync, native-data imports, employer-specific leave exemptions, and
historical policy versions remain out of scope.
