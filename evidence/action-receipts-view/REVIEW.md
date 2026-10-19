# Review — action-receipts-view

Rounds are appended below, newest last. Never edit or delete a previous round.
Format and scoring rules: `factory/RUBRIC.md`.

## Round 1 — 2026-10-19 — 5/5

**Reviewer:** factory-reviewer subagent (Claude Opus 5.5), clean context, invoked under session_01DKfbobDano1mFhd4XFokPt. This is not the builder context, and I was given no build transcript. My inputs were `specs/action-receipts-view.md`, `git diff 9294da6..HEAD` (HEAD `380b4de`) and `evidence/action-receipts-view/`, including all screenshots.

**What the evidence shows on its own, read before the diff:** before (`b332d40`), `/actions` is a 404 for both Demo Co and Northwind, and Budgets has no Actions nav link. After, a signed-in user opens Actions from the nav and sees only their org's guard receipts. Each receipt shows time, agent, tool.action, resource, amount, policy and version, decision, execution status and decision id. "Pending approval" is a neutral badge. The forged approval is called out in words on its row. A banner states that nothing on the page was approved through ARK. Summary tiles carry `measured n=7`. Only "completed" is green and "outcome unknown" is amber. The page stacks into cards at 390 with no page h-scroll. Northwind gets an empty state with a README link. The error boundary renders readable text with an error reference. Budgets gains one sender-reported line with a link to Actions. I could answer criterion 2's question from the artifacts alone.

**Commands I re-ran (Node v22.22.0, worktree at `380b4de`):**
- `rm -rf packages/*/dist && npm ci && npm run build:packages`: exit 0. This was a clean build of every package, with `@ark/db` built before `@ark/guard`.
- `npm run db:bootstrap` against a fresh file DB: exit 0. It logged "Ran 8 guarded refund scenarios through guardTool: 7 action receipts for org_demo". I queried the DB directly: 7 rows under `org_demo`, 1 under `org_other`, none under `org_northwind`. Decision and status order match the bootstrap test.
- `npm test`: exit 0, 0 failures in every suite.
- `npm run typecheck`: exit 0.
- `npm run build --workspace @ark/control`: exit 0. `/actions` is built as a dynamic route, with no "critical dependency" warning from the computed import.
- `deploy/Dockerfile` runs `npm ci && npm run build:packages` before the entrypoint's `db:bootstrap`, so the image builds `@ark/guard/dist` before the seed needs it.

**Risk checks:**
- **Org scoping.** `apps/control/src/app/actions/page.tsx:107-111` takes `orgId` only from `requireOrg()` and passes it to both reads. Both `listActionReceipts` and `countActionReceipts` (`packages/db/src/action-receipts.ts:733-770`) bind `org_id = ?`, and neither has an unscoped variant. The page is a server component and makes no client fetch. Isolation is tested with the same decision ids in two orgs plus an unknown org (`packages/db/src/action-receipts.test.ts:669-696`).
- **No overclaim.**
  - `require_approval` maps to "pending approval" and nothing maps to approved (`apps/control/src/lib/receipts.ts:493-504`, tested at `receipts.test.ts:351-354`).
  - The ignored sender-reported approval is stated on its row (`page.tsx:223-225`).
  - `attempted` reads as "outcome unknown" with a "may have executed" note. A missing status reads "unknown" with a neutral tone (`receipts.ts:511-533`).
  - The DB `CHECK`s at `packages/db/src/sql.ts:157,160` make an unrecognised stored value impossible anyway.
  - Decision tiles and badges are neutral. Execution colour goes through `toneFor(claim, …)` on a `measured` basis, so colour follows provenance.
- **The `@ark/db` → `@ark/guard` dependency.** It is declared in EVIDENCE.md. It has no build cycle, because the computed specifier at `packages/db/src/seed.ts:872` means `tsc` for `@ark/db` never resolves `@ark/guard`. It has no runtime cycle, because the guard's runtime code does not import `@ark/db`. It works from a clean install, as shown in the commands above. `@ark/db`'s index does not re-export `seed.ts`, so Control never loads it.

**The declared deviations, judged one by one:**
- The workspace dependency and the computed import are sound, as checked above. They are needed because the spec requires the seed in `@ark/db` to run `guardTool`.
- The `./demo` subpath export is the right way to expose the scenarios, rather than reaching into `dist/`.
- Adding `action_receipts` to the seed's wipe list and back-dating the guard's clock are both correct. Without the first, a re-seed would hit duplicate keys. Without the second, receipts would be dated in the future.
- The `org_other` receipt is an orphan row with no `orgs` entry and no members. It is unreachable through `requireOrg()` and asserted in `bootstrap.test.ts:804`. I accept it.
- Showing `attempted` as "outcome unknown" is the conservative reading and is required by "never success". I accept it.
- `scope="col"` on every `@ark/ui` `<th>` is an accessibility attribute with no visual change, and the `label` prop is opt-in. This does not breach "no changes to other pages".
- The `<details>` correlation id meets the keyboard criterion, as shown in `a11y.txt`.
- The `shots.mjs` edit does not affect the before values: the page was a 404 with 0 rows.
- An HTTP 500 under `error.tsx` is Next's behaviour, and the page text is readable.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All six acceptance criteria are met as written: route and nav; table fields and the three display rules; measured tiles with neutral decisions; the Budgets line; empty, error, 390 and keyboard states; seed via `guardTool` plus the db isolation test. The scope changes beyond the spec are declared. |
| 2 | Evidence proves it | ✅ | Before was captured at the spec commit (`b332d40`, dirty=0) before any code existed. After used the same `shots.mjs`, the same fresh bootstrap, production build, 1280 and 390, and the same two logins. The "does not prove" list is specific: synthetic data, one browser, no screen reader, no adversarial session test, simulation as a naming convention. |
| 3 | Structure holds | ✅ | The edge calls org-scoped typed reads in `@ark/db`, as the spec requires and as Budgets already does. It touches no client. `receipts.ts` is pure and imports nothing from the framework. The new workspace dependency is declared. No third-party dependency was added. |
| 4 | Fails safely | ✅ | Read failures reach `actions/error.tsx`, which shows readable text, an error digest and Try again, with no stack (provoked for real in `after-actions-error-1280.png`). The org comes only from the session. The list limit is clamped to 1..1000. No new external calls. No swallowed errors: the `formatAmount` catch returns an explicit minor-units fallback. |
| 5 | Readable | ✅ | Comments explain the non-obvious *why*: the computed specifier, `attempted` mapped to outcome unknown, the clock offset, the unknown-currency guard, and `<details>` instead of hover. Tests cover the label, tone, tally and isolation logic. There is no dead or debug code. |

**Blocking:** none.

**Non-blocking:**
- `packages/db/src/seed.ts:863-869`: `GuardDemo` is a hand-copied type with no compile-time link to `@ark/guard/demo`. Only `bootstrap.test.ts:783` catches drift, and only at runtime. A longer-term fix is to move the seed, which is a job and not an adapter, into a package that can depend on both `@ark/db` and `@ark/guard` normally. That would remove the package-level cycle (`@ark/db` dep → `@ark/guard`, `@ark/guard` devDep → `@ark/db`) entirely.
- `packages/db/src/seed.ts:827`: `seedActionReceipts` runs before `seedSecondOrg` and `seedAuth`. If `@ark/guard` is unbuilt, for example after building `@ark/db` alone, the seed throws after `orgs` is written. Bootstrap then reports "already-seeded" forever, with no logins, until someone runs `npm run db:seed`. Running it last, or failing fast on the import before the wipe, would avoid the half-seeded DB.
- The seed produces no receipt with a `trace_id`, so the trace half of the correlation cell (`page.tsx:233`) is never shown in the evidence.
- `page.tsx:76`: the README link is pinned to GitHub `main`. It resolves now that PR-3 has merged, but it will point at `main` even from older deployments.
- At 390 the nav cuts off at "Act…" (`after-actions-demo-390.png`). This is the existing nav's horizontal scroll, not page scroll, and is not a regression from this change.
- `receipts.ts:536-541`: the `executionTone` doc comment talks about decision tones, which this function does not set. That belongs on the decision tiles at `page.tsx:158`, which already say it.
