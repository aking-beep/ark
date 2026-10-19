# Evidence — action-receipts-view

## What changed

A signed-in Control user can now open **Actions** from the nav and see, for
their own org only, every action `@ark/guard` decided on: what was requested
(time, agent, tool and action, resource, amount), the policy and its version,
the decision (`allow` / `deny` / `pending approval` / `unknown`), what actually
executed (`completed` / `not attempted` / `failed` / `outcome unknown`), and the
decision id to correlate on. Summary tiles count receipts by decision and by
execution status, each tagged `measured n=<receipts>`. Before this change
`/actions` was a 404 and the only "approval" Control showed was the
sender-asserted `approvedBy` on Budgets, which now says in one line that it is
sender-reported and links to Actions.

## How it was measured

Worktree root, Node 22, Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Same procedure before and
after:

```
npm ci && npm run build:packages
npm run build --workspace @ark/control                       # production build
rm -f <scratch>/X.db && ARK_DATABASE_URL=file:<scratch>/X.db npm run db:bootstrap   # fresh DB, dev (non-production) seed
ARK_DATABASE_URL=file:<scratch>/X.db ARK_SESSION_SECRET=<random 32 bytes hex> npm run start --workspace @ark/control
node evidence/action-receipts-view/shots.mjs before|after   # http://localhost:3002
```

`shots.mjs` signs in as Demo Co (`dana@riverbend.example`) and as Northwind
(`sam@northwind.example`) — the published dev seed logins — and, at 1280x900
and 390x844, records each route's HTTP status, `h1`, whether the nav has an
"Actions" link, the number of visible receipt rows, and
`scrollWidth > clientWidth` (horizontal page scroll), then saves a full-page
screenshot. Output: `before.txt` / `after.txt`.

After only (before, `/actions` is a 404 and there is nothing to probe):

- `node evidence/action-receipts-view/a11y.mjs` — Tab order through
  `/actions` at 1280, Enter on a correlation-id `<summary>`, and header vs cell
  `text-align` plus `scope` for every column of the receipts table →
  `a11y.txt`.
- `node evidence/action-receipts-view/error-state.mjs` — the error boundary,
  provoked for real: `next start` on a copy of the after DB with
  `DROP TABLE action_receipts`, so the org-scoped read throws → appended to
  `after.txt`, `after-actions-error-1280.png`.
- `after-test.txt` — the receipts/bootstrap db tests and the Control unit
  tests, captured whole with exit codes.

Conditions that change the result: the seed is relative to `Date.now()`, so
every timestamp (and every decision id, which hashes the guard's clock) differs
per run; the decisions, statuses, amounts, order and counts do not.

## Before / after

| | Before (`b332d40`) | After (`322e62e`) |
|---|---|---|
| `/actions`, Demo Co, 1280 | 404 — `before-actions-demo-1280.png` | 200, 7 receipt rows, no h-scroll — `after-actions-demo-1280.png` |
| `/actions`, Demo Co, 390 | 404 — `before-actions-demo-390.png` | 200, 7 stacked cards, scrollWidth 390 = clientWidth 390 — `after-actions-demo-390.png` |
| `/actions`, Northwind, 1280 / 390 | 404 — `before-actions-northwind-*.png` | 200, 0 rows, empty state linking `packages/guard/README.md` — `after-actions-northwind-*.png` |
| `/budgets`, Demo Co, 1280 / 390 | no Actions nav link — `before-budgets-demo-*.png` | Actions in nav; the one sender-reported line + link in the unapproved-actions panel — `after-budgets-demo-*.png` |
| Nav "Actions" link (all six captures) | false | true |
| Horizontal page scroll (all captures) | false | false |
| `/actions` error boundary | n/a | HTTP 500, "Actions could not be loaded", no SQL/stack text — `after-actions-error-1280.png` |
| Keyboard / headers (`a11y.txt`) | n/a | table region and all 7 correlation `<summary>`s reachable by Tab; Enter opens the full 64-char id; 9/9 columns header-align = cell-align, all `scope=col` |

Demo Co's seven receipts are what `guardTool` wrote when the seed ran the PR-3
scenarios against the seed DB: `allow`+`completed` ($75, ord_1001),
`pending approval`+`not attempted` ($750), `deny` ($5,000), `unknown`
(`billing.refund`, no matching policy), `pending approval` with the forged
`approvedBy` stated in words on the row, the $75 replay (`allow`,
`idempotency_replay`, `not attempted`), and `allow`+`outcome unknown` (handler
crashed after starting). Tiles: allow 3, deny 1, pending approval 2, unknown 1;
completed 1, not attempted 5, failed 0, outcome unknown 1; all `measured n=7`.

Capture timestamps and commit SHAs are in `captures.tsv`. The `after` stamp's
`dirty=12` is the uncommitted evidence files themselves; the after screenshots
were taken from a tree whose source was identical to `322e62e` (the only later
edit was a comment in `error-state.mjs`).

## What this does not prove

- **Seeded, synthetic data only.** Seven receipts from one demo agent and one
  tool; no production shapes, no volume. The list is capped at the 200 most
  recent (the tiles count all); pagination past 200 is untested in the browser.
- **One browser** (headless Chromium), two widths. The 390 check is
  "no horizontal page scroll", not a visual review on real devices.
- **Keyboard only, not a screen-reader test.** `a11y.txt` shows focus order and
  header alignment; nobody listened to the page with a screen reader.
- **Org isolation is proved at the query** (`action-receipts.test.ts`: two orgs
  with the same decision ids, plus an unknown org) **and by the Northwind
  capture** — not by an adversarial test against the running app (e.g. a
  tampered session cookie). Session handling is unchanged from before.
- **"Simulation" is an identifier convention, not a stored flag.** A receipt is
  badged when the agent is the guard demo's `agent_support_bot` and the tool is
  `payments.refund` or `billing.refund`. A real agent given that exact id would
  be mis-badged; a different demo would not be badged. Receipts have no column
  that records provenance-of-run.
- **The error boundary was shown for one failure** (missing table). Other
  failures (DB unreachable, timeout) take the same boundary but were not
  provoked.
- **The README link points at GitHub `main`.** It resolves once PR-3 (which adds
  `packages/guard/README.md`) is merged; on this stacked branch it does not yet.

## Deviations

- **Workspace dependency `@ark/db` → `@ark/guard` (declared in
  `packages/db/package.json`, lockfile updated by one line).** The spec requires
  the seed — which lives in `@ark/db` — to run the guard's scenarios. `@ark/guard`
  already dev-depends on `@ark/db` (its demo and tests use the libSQL store), so
  this is a cycle at build time. The seed therefore imports `@ark/guard/demo`
  through a computed specifier and types the slice it uses locally
  (`GuardDemo` in `seed.ts`); there is no cycle at runtime (the guard's runtime
  code does not import `@ark/db`). No third-party dependency was added.
- **`@ark/guard` gains a `./demo` subpath export** (`dist/demo/scenarios.js`) so
  the seed can call `runRefundScenarios` without reaching into `dist/` paths.
  The scenarios themselves are unchanged.
- **The seed's wipe list now includes `action_receipts`**, and the guard's
  clock starts two hours before the seed's `now` (ticking 1 ms per read), so no
  receipt is dated in the future. The cross-tenant scenario stores its receipt
  under `org_other` (the context's org, which has no members); the bootstrap
  test asserts it is not under Demo Co or Northwind.
- **`attempted` (possibly executed) is shown as "outcome unknown"** with a note,
  and counted in that tile, because the spec's four statuses have no
  "attempted" and it must never read as success. Seeded data contains none.
- **`@ark/ui` `Table`**: every `<th>` now has `scope="col"` (all tables), and an
  optional `label` makes the scroll container a labelled, focusable region
  (used only by `/actions`). Other pages are otherwise unchanged.
- **Correlation ids** show their first 16 characters in a `<details>`/`<summary>`;
  the full id is one Enter away (not hover-only).
- **`shots.mjs` was edited once after the before capture**: the receipt-row
  count now counts only visible markers, because the table and the stacked cards
  both render and one is hidden. The before value (0, on a 404) is unaffected.
- **Error boundary HTTP status is 500** (Next's behaviour for a server error
  under an `error.tsx`), with a readable message and the error digest.

## Definition of done

- **Cost / latency impact:** one extra page making two indexed reads per load
  (`action_receipts_created_idx` on `(org_id, created_at)`; list capped at 200).
  The seed adds eight guard calls (milliseconds). No effect on other pages beyond
  one paragraph on Budgets. Not load-tested.
- **Observability for new failure modes:** a failed read renders the error
  boundary with Next's error digest, which matches the server log line. No new
  metrics.
- **Docs or ADR updated:** none. The empty state points to the existing
  `packages/guard/README.md`; ADR-0009 already covers receipts. `npm test`,
  `npm run typecheck` and `npm run build` pass at `322e62e`.
