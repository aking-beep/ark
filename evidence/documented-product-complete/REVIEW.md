# Review — documented-product-complete

## From the artefacts (before the diff)

A person who has not read the code can already see the change.

**Before** (`before.txt`, `before-*.html`): a seeded workload stored only `{verdict,score}`; `calibration_snapshots` stayed at 0 even after `GET /api/v1/calibration`; ingest documented `events`/`traces` only; `/workloads/wl_support_triage` had no “Estimate drift”; consumer `/result` showed “Per month” and “Suggested model” and no copy control; the landing promised “a rough monthly cost” and “Real prices”.

**After** (`after.txt`, `after-*.html`): the same seeded workload stores a full assessment (`cost.perUnit`, `architecture`); seed writes a snapshot and a normal calibration GET writes another; ingest documents `actions` and `qualitySamples`; the drift page shows **Estimate drift: +1813%**; a valid consumer result has **Copy link** and “This link contains your answers”, no monthly cost, no suggested model; garbage `i` still recovers with no copy control; landing no longer promises a cost; a live POST of an irreversible action with no `approvedBy` returns `actionsAccepted: 1, alerts: 1`.

That is enough to score criterion 2. Limits the artefacts themselves name: the copy button was not clicked; token paste was not driven through the business UI; quality-regression and budget alerts were not exercised on the live POST; CI has not run on GitHub.

## Round 1 — 2026-09-15 — 4/5

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All six acceptance criteria are met as written: full seeded assessment and a numeric drift figure; versioned calibration snapshots on the normal GET path; consumer six-question PRD surface with copy control, no cost/model, no calibration fetch, legacy `i` still decodes; ingest accepts actions/quality samples and can raise `unapproved_action` / `quality_regression` / `budget_warn` / `budget_breach`; `estimateTokens` on business intake and `@ark/sdk` without `@ark/db`; ~40 golden cases with a 30% kill test and CI workflows for typecheck/test and weekly `refresh:models`. `findRepoRoot` walking to `factory.config.json` is declared in `EVIDENCE.md`. |
| 2 | Evidence proves it | ✅ | Before at `055ed91` dirty=0, after at `c392011`, same encoded intake, same routes, SQL + HTTP + HTML side by side. `EVIDENCE.md` “what this does not prove” is specific (synthetic drift, copy not clicked, token paste unit-tested only, CI not run on GitHub). |
| 3 | Structure holds | ✅ | Ingest SQL left the route: `apps/control/src/app/api/v1/events/route.ts` parses and calls `applyIngest`; calibration snapshot SQL moved to `persistCalibrationSnapshot`. Services take typed values, not `Request`. `@ark/sdk` depends only on `@ark/core`. No undeclared third-party runtime dependency. |
| 4 | Fails safely | ❌ | New SDK POST has no timeout — a hung Control hangs the caller. New copy control does not handle a missing or rejecting clipboard. See blocking. |
| 5 | Readable | ✅ | Names match the spec (`doesSomething`, `persistCalibrationSnapshot`, `GOLDEN_KILL_RATE`). Comments explain why (consumer does not fetch calibration; snapshots never UPDATE; token estimate is not a tokenizer). Tests sit next to ingest alerts, golden scoring, SDK turn assignment, `copyHref`, and `estimateTokens`. |

**Blocking:** criterion 4.

- `packages/sdk/src/index.ts:66` — `this.fetchFn(url, { method: 'POST', headers, body: JSON.stringify(parsed) })` has no `AbortSignal` / timeout. A hung Control leaves `ArkIngest.ingest` / `TraceHandle.flush` pending with no bound. Pass an `AbortSignal` (or `AbortSignal.timeout(...)`) on that fetch so a dead ingest host fails closed. That earns the point back.
- `apps/consumer/src/components/copy-result-link.tsx:9-11` — `onClick` awaits `copyHref(navigator.clipboard, …)` with no `try/catch`. In a non-secure context `navigator.clipboard` is undefined; a denied permission rejects. Either path is an unhandled rejection and the button never explains the miss. Catch, leave the label uncopied, and tell the user they can copy the URL by hand. That is also required to earn criterion 4.

**Non-blocking:**

- `EVIDENCE.md` already says the copy control was not clicked and token paste was not driven through the business UI; those gaps did not cost criterion 2 because the honest limit is written down and the before/after HTML still shows the control and the landing/result copy change.
- `packages/db/src/ingest.ts:59-186` writes events, traces, actions, quality samples, and alerts as separate statements with no transaction. Retry is mostly safe (`INSERT OR IGNORE`) but a crash mid-batch can leave a partial ingest. Not a new pattern on this route; still worth wrapping.
- `captures.tsv` records the after capture as `dirty=5` at `c392011`. Consistent with writing the evidence files themselves; not a reconstructed before.

## Round 2 — 2026-09-15 — 5/5

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All six acceptance criteria are met as written. Seeded assessments include `cost.perUnit` and `architecture.callShape`; `/workloads/wl_support_triage` renders a numeric estimate-drift percentage. `GET /api/v1/calibration` inserts a snapshot on the normal path; seed writes one; persist is INSERT-only. Consumer asks the six PRD questions, shows verdict/pattern/unlocks/basis plus a copy control that discloses the link contains answers, shows neither cost nor a model, does not fetch calibration, recovers on garbage `i`, and still decodes legacy fields. Ingest accepts `actions`/`qualitySamples` and can emit `unapproved_action` / `quality_regression` / `budget_warn` / `budget_breach`; `sample` is scanned and discarded. `estimateTokens` is on business intake and labelled heuristic; `@ark/sdk` assigns trace ids and turn indices and depends only on `@ark/core`. Golden set is ~40 cases with a 30% kill test; CI runs typecheck/test on PRs and weekly `refresh:models`. `findRepoRoot` walking to `factory.config.json` remains declared in `EVIDENCE.md`. |
| 2 | Evidence proves it | ✅ | From the artefacts alone: before (`055ed91`, dirty=0) has stub assessments, zero snapshots, ingest of events/traces only, no Estimate drift, consumer cost/model and no copy control, landing promises a monthly cost. After (`c392011`) has full assessment keys, snapshots 1 then 2 after GET, ingest documents actions/qualitySamples, drift **+1813%**, Copy link + “link contains your answers”, no cost/model, garbage `i` recovers without copy, landing does not promise cost, live unapproved action returns `actionsAccepted: 1, alerts: 1`. Same encoded intake, same routes. “What this does not prove” names synthetic drift, copy not clicked, token paste unit-tested only, CI not run on GitHub. After HTML was captured before the fail-safely follow-up; `EVIDENCE.md` states that limit. That does not cost this point — before/after still prove the product change. |
| 3 | Structure holds | ✅ | Ingest route authorises, `safeParse`s, and calls `applyIngest` with typed values, not `Request`. Snapshot SQL lives in `persistCalibrationSnapshot`. `@ark/sdk` constructs the ingest client and depends only on `@ark/core`. No undeclared third-party runtime dependency. |
| 4 | Fails safely | ✅ | Round 1’s two paths now fail closed. `ArkIngest.ingest` aborts the POST after `timeoutMs` (default 10s) and throws a timeout error (`packages/sdk/src/index.ts:68-87`); covered by the hung-Control test. `CopyResultLink` catches a missing or rejecting clipboard, leaves the button uncopied, and tells the user to copy the address bar (`apps/consumer/src/components/copy-result-link.tsx:10-18, 33-37`); `copyHref` throws when clipboard is absent. New ingest input is Zod-validated at the route (`safeParse` → 422). Garbage `i` still yields the recovery panel. Consumer does not fetch calibration. No other new external call lacks a timeout; no remaining swallowed error, hang, blank screen, or unvalidated trust-boundary input of that class in the new code. |
| 5 | Readable | ✅ | Names match the spec (`doesSomething`, `persistCalibrationSnapshot`, `GOLDEN_KILL_RATE`, `timeoutMs`). Comments explain why (consumer does not fetch calibration; snapshots never UPDATE; token estimate is not a tokenizer; ingest POST must not hang the caller). Tests sit next to ingest alerts, golden scoring, SDK turn assignment and timeout, `copyHref` fail-closed, and `estimateTokens`. |

**Blocking:** none.

**Non-blocking:**

- After HTML still shows the success-path copy button, not the clipboard-failure message. `EVIDENCE.md` already says so; the fail-closed path is unit-tested.
- `packages/db/src/ingest.ts:59-186` still writes events, traces, actions, quality samples, and alerts as separate statements with no transaction. Retry is mostly safe (`INSERT OR IGNORE`); a crash mid-batch can leave a partial ingest. Same note as Round 1.
- `apps/control/src/lib/ingest.ts:1-3` still re-exports `EventInput`, `TraceClose`, `detectSensitive`, and `priceEvent`; the route only imports `IngestBody`, `allowlist`, and `authorize`. Harmless leftover, not a scoring issue.
