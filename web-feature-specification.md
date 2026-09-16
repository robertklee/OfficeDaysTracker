# RTO Planner Web — Feature Specification

Status: Proposed specification; no website implementation or deployment authorized.

## 1. Product purpose

A private, employee-owned website for logging attendance, understanding an employer's return-to-office policy, and finding a workable office schedule around planned remote days and leave.

The dashboard answers:

1. What does my recorded attendance show?
2. Where does my future plan create risk?
3. Which available days or weeks could resolve that risk?

This is an advisory planning tool, not employer-certified evidence of compliance. Calculations must explain their assumptions, especially where company policy differs.

## 2. Confirmed scope

The first web release is local-first, hosted on Cloudflare Pages, usable without an account, with browser persistence, offline support, and export/import backups. Accounts and cross-device synchronization are deferred.

The existing Swift app is a product reference, not a codebase to translate mechanically. Current source includes five day types, actual/planned entries, per-day must priorities, an eraser, drag ranges, adjacent-month dates, a Today shortcut, policy start dates, selectable week starts, rolling threshold/average modes, projection UI, and strategic week summaries.

Important corrections for the web implementation:

- Existing projection code passes planned records through unchanged; this does not reliably simulate future attendance across all formulas.
- Existing strategy suggestions are heuristic. Extra office days do not necessarily compensate for a missed week, especially under weekly-threshold or required-weekday policies.
- Existing date storage uses device-local midnight. Web attendance dates must be timezone-independent from the outset.
- Some existing ramp-up behavior hides warnings. Web current-status grace and future-plan risk must be separate concepts.

### Release boundaries

| Web MVP | Later releases |
|---|---|
| Responsive Dashboard, Calendar, Settings | Accounts and cross-device synchronization |
| Instant logging, range painting, erase, undo | Calendar integrations and native-app data transfer |
| Actual/planned distinction and protected days | Scheduled Web Push while the site is closed |
| Three policy families, including two rolling modes | Custom user-authored formula builder |
| Explainable forecasts and suggested plan changes | Employer-specific leave exemptions and policy history |
| Timezone-safe dates and fixed policy timezone | Team presence and collaboration features |
| Offline PWA and browser-local data | Background location/geofencing, if platform-feasible |
| Versioned JSON backup/restore; CSV attendance export | Employer reporting integrations |
| In-app reminders and accessible interactions | Advanced analytics |

No login wall, D1 database, Pages Functions, third-party tracking, or server-side attendance processing is needed for the MVP.

## 3. User journeys and navigation

**First visit:** explain local storage and backup limitations; configure policy type, enforcement date, policy week start, and policy timezone; show a readable policy summary for confirmation. Default to average mode using the best 8 of 12 weeks with a 3-day average target, but never label this as the user's employer policy until confirmed.

**Daily use:** open Calendar, choose Office or Remote, tap or paint dates, see saved status and updated forecast. Future entries default to planned; today/past entries default to actual. Plans are never silently promoted to actual attendance as time passes.

**Plan ahead:** mark remote or leave dates, protect must days, inspect the forecast, preview suggested changes, and explicitly apply them.

**Return later:** restore the same browser's data, recalculate against the current policy-local date, and highlight past planned entries that still need confirmation.

Desktop uses a persistent navigation rail and wider dashboard panels. Mobile uses bottom navigation and stacked panels. Routes are `/dashboard`, `/calendar`, and `/settings`; first-run setup and import review may be dialogs or dedicated routes.

## 4. Calendar and attendance

### Fast entry

- Primary tools: Office, Remote, and Eraser. Vacation, Sick, Holiday, notes, and must priority remain available through secondary controls and an accessible details action.
- Taps paint the selected type; repeated paint is idempotent. Eraser explicitly removes an entry. This intentionally replaces the older tap-again-to-clear ambiguity.
- Mouse/touch dragging previews an inclusive chronological range from the starting date to the current date, including intermediate dates even when pointer events skip cells.
- Dragging skips Saturday/Sunday by default. A visible Include weekends option overrides this; individual weekend taps remain supported.
- Pointer release applies one transaction and creates one undo action. Pointer cancellation or Escape discards the preview without writing.
- Range start/end controls and Shift+keyboard selection provide alternatives to dragging. Painting must not prevent scrolling outside the grid.
- Today jumps to the current policy-local month and focuses today's date; previous/next controls and adjacent-month dates preserve orientation.

### Visual semantics

- Explicit office: blue; explicit remote: green; leave types have distinct labels/icons.
- If any entry exists in a policy week, unentered weekdays in that week receive faint green shading as a visual remote hint. This creates no records and is not an explicit remote plan or forecast constraint.
- Untouched weeks remain neutral. Deleting the last entry removes that week's hints.
- Unentered weekends use a visibly darker neutral gray. Explicit entries take precedence, while a weekend label remains available.
- Planned status uses an outline or badge, not color opacity alone. Must priorities use an icon plus text in the accessible name.
- Clear planned days requires a confirmation with affected count and preserves actual attendance. Protected entries are excluded unless the user explicitly includes them.

### Priority semantics

A must-priority office day fixes that office commitment. A must-priority remote day fixes that non-office commitment. Vacation, sick leave, and holidays are unavailable for automatic office suggestions.

Protection restricts recommendations; it does not waive the company's requirement. A protected conflict must be reported, never hidden by lowering the policy target. Manual changes to protected entries require an explicit confirmation.

## 5. Policy engine and date rules

### Policy families

| Policy | Exact meaning |
|---|---|
| Best X of Y, qualifying-week mode | At least X of the last Y eligible completed policy weeks have at least N office days each. Surplus days in one week cannot rescue another week. |
| Best X of Y, average mode | Select the X highest office-day totals in the last Y eligible completed weeks; their combined total must be at least X times N. |
| Minimum days per week | Each evaluated completed week independently requires N office days. |
| Specific weekdays | Each configured weekday in each evaluated completed week requires office attendance. |

Configuration validation: integer X/Y in 1...52, X <= Y, integer N in 1...5, nonempty unique required weekdays selected from Monday-Friday, a real start date, and a valid IANA timezone. Weekly policies use a four-week reporting window by default; this window is not permission to average away a missed week.

A developer-added formula implements a typed contract for configuration validation, evaluation, explanation, and recommendation support, then registers its metadata. MVP does not execute arbitrary user expressions or uploaded code.

### Explicit defaults and assumptions

- The policy week starts Monday by default, selectable as Monday, Sunday, or Saturday; this setting controls both calendar grouping and calculations. Explain that changing it can change results. Saturday/Sunday remain weekends regardless of column order.
- Count every recorded office date toward MVP policy totals, including Saturdays and Sundays. Specific-weekday policies still require their configured weekdays.
- Never count attendance before the enforcement start date. If enforcement starts mid-policy-week, begin formal weekly evaluation with the next full policy week; show the initial partial week as informational. This is a disclosed app default, not a claim about every employer's policy.
- Current-week progress is provisional. Formal current compliance evaluates completed weeks only and excludes future actual records.
- For a rolling policy, ramp-up lasts until Y full eligible weeks have completed. Show provisional progress using `ceil(X * eligibleCompletedWeeks / Y)` required qualifying weeks, or that many best weeks in average mode. Do not show a formal failure label during this disclosed initialization period.
- For weekly/required-weekday policies, initialization ends when the first full eligible week completes. Thereafter evaluate completed obligations normally; do not mask violations for the entire reporting window.
- Future enforcement dates show Not started. Zero eligible weeks show Gathering history, not a fabricated 100% success.
- Leave is non-office and unavailable for scheduling by default; it does not automatically reduce policy thresholds. Explain that employer exemptions are not modeled in MVP.
- Changing policy settings previews the recalculation and applies to the active evaluation model. Historical policy versioning is deferred; disclose retrospective recalculation.

### Timezone-safe storage

Attendance dates, priority dates, and enforcement dates are validated Gregorian civil-date strings (`YYYY-MM-DD`), not midnight timestamps. Store audit times such as created/updated timestamps as UTC instants.

Use `Temporal.PlainDate` through a supported polyfill for civil-date arithmetic. Never parse attendance keys using `new Date("YYYY-MM-DD")` and render them in the device timezone.

Default the policy timezone to the device's IANA timezone at setup and persist it. Derive today, week completion, and due dates in that timezone. Travel must not move existing entries or silently change policy boundaries.

Allow an explicit timezone change with a before/after explanation of today and due-date changes; existing civil-date keys remain unchanged. Existing native records cannot always be migrated losslessly without their original timezone. Native-data import is deferred rather than silently guessing dates.

## 6. Forecasting and recommendations

### Forecast inputs and horizon

Forecast from the current unfinished week through the next `max(12, policyWindowWeeks)` policy weeks. Label the horizon and end date. Do not imply safety beyond it.

Use immutable snapshots: confirmed actual history, explicit future office/non-office plans, protected dates, policy configuration, and a supplied reference date. Simulation never modifies persisted status.

Unentered future days remain unknown, even when faintly shaded green. Evaluate two clearly labeled cases:

1. **Committed-plan case:** actual history plus explicit office plans; assume no additional office attendance on unknown dates.
2. **Available-capacity case:** add office attendance on every eligible unknown future date while preserving explicit non-office plans and protected commitments.

Classify outcomes:

- **On track under recorded plan:** committed-plan case meets all enforceable checkpoints in the horizon.
- **More planning needed:** committed plan falls short but available capacity can meet the requirement; show the first affected week and actions needed.
- **Plan conflicts with policy:** even available capacity cannot meet a checkpoint without changing an explicit plan or protection.
- **Gathering history / not started:** no formal checkpoint yet; show provisional planning needs without claiming established compliance.
- **Unable to evaluate:** invalid configuration, storage failure, or unsupported formula; never return a success-shaped fallback.

Use future week-end checkpoints derived from the configured week start, not a fixed day offset assuming Monday. Planned office entries become attendance only inside the simulated snapshot, including all intervening simulated weeks.

Show risk even if the user is compliant today. During current ramp-up, use advisory language about upcoming checkpoints rather than declaring the user out of policy now.

### Actionable guidance

- Report earliest affected week, evaluation window, expiring qualifying weeks where applicable, committed office count, and remaining available dates.
- Distinguish historical deficits from office days still actionable. Never describe an irreparable historical shortfall as days the user can add this week.
- Suggestions may fill unknown weekdays. Explicit remote plans are not overwritten; if changing them is necessary, present a separate user-reviewed alternative. Protected/leave dates are not proposed for conversion.
- Label a specific day Required only when it is actually mandated or unavoidable; otherwise present suggested dates and interchangeable choices.
- Preview changes and recompute the entire horizon before allowing Apply. Applying adds planned entries in one undoable transaction.
- Strategic week labels are Standard, Load, and Protected Remote. A Load recommendation must demonstrate improvement under the selected formula, not simply add one office day by heuristic.
- Do not promise globally optimal scheduling. Use a deterministic feasible-plan search with declared tie-breaks: preserve commitments, prefer fewer added days, then earlier dates. Only label impossibility if the available-capacity evaluation proves it; a search that cannot find a plan reports that limitation separately.

Recalculate after every committed attendance/priority change, undo, import, policy edit, and local data update from another tab, plus on focus and policy-local date rollover. Count-only change detection is insufficient.

## 7. Persistence, backup, and offline behavior

- IndexedDB stores records, policy, preferences, and schema version; use Dexie for transactions and reactive reads. Persist a complete paint/apply action atomically.
- Show Saving, Saved on this browser, and actionable failure states. On quota or unavailable-storage errors, retain unsaved edits for retry/export; never claim success.
- Support same-origin multi-tab updates through reactive subscriptions, with per-record revision checks to reject conflicting stale edits rather than silently overwrite.
- Request persistent storage when supported and explain that browser eviction, private browsing, clearing site data, or changing browsers can still lose records.
- JSON export contains a format version and all attendance, priority, policy, and preference data. CSV is attendance-only and not a complete backup.
- Import validates schema, dates, enums, parameter limits, duplicates, and a 5 MB file-size limit before writing. Show a preview and require confirmation for atomic replacement of the local dataset. On failure preserve the original dataset.
- Offer a pre-replacement backup and a separate explicit Delete all local data confirmation.
- A service worker caches the application shell after a successful online visit. Calendar, calculations, edits, and export then work offline.
- Show offline/install status; installation is optional. Offer an update prompt rather than reload during editing. Coordinate versioned IndexedDB migrations with older tabs and retain data on migration failure.
- Production must use a stable origin. `pages.dev`, preview URLs, and a custom domain have separate browser stores; moving domains requires user export/import, not an automatic data transfer.

## 8. Browser reminders and accessibility

MVP provides in-app reminders to confirm past planned days and review upcoming gaps when the site is open. It does not promise timed notifications after a tab is closed. Do not ship a misleading native-style reminder toggle.

Later Web Push requires opt-in subscriptions, secure server-side delivery, and a scheduler. A Worker with Cron Triggers can schedule delivery; Pages Functions can handle subscription APIs. iOS/iPadOS Web Push requires a supported Home Screen web app and permission requested from a user interaction. Delivery is best-effort, not an exact-time guarantee.

Target WCAG 2.2 AA: keyboard-operable calendar grid, visible focus, screen-reader labels for date/type/status/priority, text equivalents for color, reduced-motion support, and touch controls at least 44 by 44 CSS pixels. At 320 CSS pixels wide the calendar must not overflow horizontally. Reflow secondary tools rather than shrinking critical controls.

Support current and previous major Safari/iOS Safari, Chrome, Edge, and Firefox releases at launch. Feature-detect installation and persistence APIs; normal website use must not depend on installation.

## 9. Proposed architecture and deployment

| Layer | Choice |
|---|---|
| UI | React + TypeScript in strict mode, Vite static build, React Router |
| Domain | Pure TypeScript policy, projection, recommendation, and civil-date modules |
| Local persistence | IndexedDB via Dexie with transactional repository boundary |
| Date arithmetic | Temporal polyfill with civil dates and explicit policy timezone |
| PWA | Manifest and Workbox-based service worker via Vite PWA integration |
| Validation | Zod schemas for settings and portable backup files |
| Tests | Vitest domain/storage tests; Playwright browser journeys |
| Hosting | Cloudflare Pages, Git-connected preview and production deployments |

Proposed new `web/` directory alongside the unchanged native app:

```text
web/
  src/
    app/                 # Routes, providers, onboarding
    features/
      calendar/
      dashboard/
      settings/
      backup/
    domain/
      dates/
      policies/
      projection/
      planning/
    data/                # IndexedDB schema, migrations, repository
    components/          # Shared accessible controls
  public/                # Manifest assets, icons, _headers
  tests/                 # Browser journeys and fixtures
  package.json
  vite.config.ts
```

Dependency direction: UI -> application operations -> pure domain and repository. Domain code has no React, browser storage, network, or wall-clock dependencies. Persist source records only; compute forecasts from a shared input snapshot rather than independently cached UI states.

Cloudflare Pages configuration: root `web`, build command `npm run build`, output `dist`, pinned Node version, lockfile-controlled CI installs. Use Pages' SPA fallback without a top-level `404.html`; handle unknown routes inside the router. Verify direct navigation and reload for every route.

Use a reviewed Content Security Policy, no third-party scripts/fonts by default, no secrets in Vite environment variables, and no attendance or notes in URLs or logs. Cloudflare serves static files and receives ordinary hosting request metadata; this is not a claim that all visits are invisible.

Production/preview origins remain separate. Preview testing uses synthetic data. Asset rollback does not roll back IndexedDB schema changes; migration compatibility is a release gate.

**Later sync architecture:** retain Pages for UI; add authenticated Pages Functions or Worker APIs with D1 for per-user records. D1 is storage, not an authentication provider. Specify identity, authorization, upload consent, conflict resolution, deletion, and migration separately before enabling sync. A shared TypeScript domain package may then run server-side; no speculative backend implementation in MVP.

## 10. Acceptance criteria and release gates

| ID | Required evidence |
|---|---|
| AC-01 | Tap logs one entry; repaint does not duplicate it; erasing and undo restore the previous state including notes/priority. |
| AC-02 | Drag from a Friday through Tuesday selects the inclusive range and skips Saturday/Sunday by default, for every supported week start. Reverse drag, skipped pointer events, and cancellation behave predictably. |
| AC-03 | A week gains/removes faint remote hints with its first/last entry; hints never become persisted records or explicit forecast constraints. |
| AC-04 | Today navigation, keyboard range input, adjacent-month dates, and protected-day confirmation work with mouse, touch, and keyboard. |
| AC-05 | A saved March 24 entry remains March 24 when browser timezone changes from America/New_York to America/Los_Angeles or Pacific/Auckland; DST, year boundaries, and leap days are covered. |
| AC-06 | For best 8/12 with 3 days, eight qualifying completed weeks pass and seven fail after ramp-up; four days in one week do not replace a missing qualifying week. Average mode is separately verified. |
| AC-07 | Future enforcement, a midweek start, no history, partial history, and current unfinished weeks never display an immediate formal failure under the stated defaults. |
| AC-08 | A fixture with qualifying weeks aging out identifies the exact first failing forecast checkpoint; planned office dates in intervening weeks affect later checkpoints without mutating stored status. |
| AC-09 | Unknown dates produce More planning needed when enough capacity remains; explicit remote/leave plans can change that to Plan conflicts with policy. Invalid configuration never produces On track. |
| AC-10 | Required-weekday fixtures cannot be repaired by attending a different weekday; surplus days cannot repair weekly-minimum violations. |
| AC-11 | Recommendations preserve protected and leave dates; every proposed successful schedule passes a full-horizon reevaluation. Historical deficits are not advertised as actionable extra days. |
| AC-12 | Editing Office to Remote without changing record count immediately updates the forecast, including after undo, reload, and another-tab edits. |
| AC-13 | First online load followed by offline reload permits logging and export; saved records survive reload, deployment update, and a tested schema migration. |
| AC-14 | Corrupt/oversized imports and quota failures show errors and preserve existing data. JSON export/import round-trips all source data. |
| AC-15 | Dashboard/calendars are operable at 320px width, with keyboard and screen reader; color is never the only status cue. |
| AC-16 | Representative mobile-browser measurements: interaction feedback within 100 ms and a forecast recalculation within 500 ms for five years of daily records and a 52-week horizon. Record device/browser used. |
| AC-17 | Pages preview and production smoke checks cover route reloads, offline startup after caching, update prompts, and origin-isolated storage. No attendance requests leave the browser in MVP. |

Use independently specified date/policy fixtures rather than assuming existing Swift tests define correct behavior. Native behavior differences documented above are intentional.

## 11. Implementation sequence

1. **web-foundation:** scaffold isolated web project, route shell, strict types, test tooling, and Pages build configuration.
2. **web-date-storage:** implement civil dates, policy timezone, IndexedDB transactions, revisions, validation, and backup/restore.
3. **web-policy-engine:** implement all policy modes and explicit initialization/current-week rules with deterministic fixtures.
4. **web-calendar:** build responsive accessible tap/range entry, hints, priority, erase/undo, and Today navigation.
5. **web-forecast:** implement snapshot simulation, scenario classifications, feasible suggestions, and whole-horizon verification.
6. **web-dashboard:** wire current status, provisional progress, forecast explanation, strategy, and apply-plan preview to all data changes.
7. **web-pwa-release:** add offline/update lifecycle, in-app reminders, browser acceptance coverage, deployment documentation, and Pages smoke checks.

Create logical commits only after the affected build and tests pass. Do not modify the native app or deploy infrastructure as part of this specification task.

## 12. Platform references

- Cloudflare Pages SPA routing and caching: https://developers.cloudflare.com/pages/configuration/serving-pages/
- Pages Git integration and preview deployments: https://developers.cloudflare.com/pages/configuration/git-integration/
- Pages Functions bindings, including D1: https://developers.cloudflare.com/pages/functions/bindings/
- Workers Cron Triggers and UTC scheduling: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- WebKit Home Screen Web Push requirements: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
