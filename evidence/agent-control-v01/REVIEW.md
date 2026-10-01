# Review — agent-control-v01

## Round 1 — 2026-10-01 — 4/5

Reviewed from `specs/agent-control-v01.md`, `evidence/agent-control-v01/`, and
`git diff main...HEAD` only. No build transcript was read. Evidence was opened
before the diff.

From the artifacts alone, a user can now: sign in to Control and open
**Discover** (GitHub URL + optional branch, documented fetch caps), **Agents**
(org registry, empty), and **Assurance** (pass/warn/fail/unknown counts); see
**Discover / Agents / Assurance** in the nav after Connect; see an **Agent
infrastructure** block on the Spend dashboard. Anon hits on those routes
redirect to login. `@ark/core` exports an Agent Manifest, discovery,
materialize, assurance and policy; a giant purpose is rejected; `agents` DDL
exists; `RuntimeRequest.agentId` is optional.

Those artifacts do **not** show a repository actually discovered, a manifest
registered, assurance run, or `/agents/[id]` rendered.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All ten acceptance criteria are met in the diff as written. `AgentRiskLevel` rename is declared in `EVIDENCE.md`. |
| 2 | Evidence proves it | ❌ | Same probe command twice, before at `ac7476f` `dirty=0`, honest “does not prove”. But before HTTP is `ABSENT` (status 0), not 404; `@ark/core` itself did not resolve; the after “yes” lines are `typeof === 'function'`, never a call. Screenshots are empty-inventory forms. The outcome (Discover → Register → Assure) is not in the artifacts. |
| 3 | Structure holds | ✅ | Edge pages call `@ark/db` the same way the rest of Control does. Scan/materialize/assurance/policy are typed core functions, not framework `Request` types. GitHub `fetch` is injected. No new npm dependency. |
| 4 | Fails safely | ✅ | GitHub calls have an 8s `AbortController`; 404/401/403 become form errors; token stays in env and out of the snapshot JSON; snapshots are capped; scanned source is not `eval`’d. Org-scoped reads. `agentId` omit still ingests. |
| 5 | Readable | ✅ | Packages and routes match the spec paths. Comments say why. Tests live next to the logic they pin. |

**Blocking:** criterion 2.
**Non-blocking:** findings below the criterion notes.

---

### 1. It does what the spec said — ✅

1. **Agent Manifest.** `packages/core/src/agents/manifest.ts` is Zod, bounded
   (`id` 128, `purpose` 2_000, array caps), closed enums, optional owner /
   policy / data. Exported from `packages/core/src/index.ts:18`. Tests cover
   parse, giant purpose, required identity (`manifest.test.ts`).

2. **Repository discovery.** `discoverRepository` takes `RepoSnapshot`
   (`scan.ts:4-15`, max 40 files × 64 KB). No clone, exec, or install. Result
   has candidates, models, tools, mcpServers, integrations, infrastructure,
   evidence, warnings, confidence. Tests: LangGraph+OpenAI+MCP, README
   false-positive, env names not values (`scan.test.ts`).

3. **Materialize.** `materialize.ts:37-94` marks `observed | inferred | unknown`.
   Owner, permissions, dataAccess, governance stay unset (`materialize.test.ts:29-36`).

4. **ARK Assurance.** Deterministic, no LLM. Groups identity / provenance /
   model / tools / permissions / data / production. Statuses
   `pass | warn | fail | unknown`. `AssuranceReport` is counts, not a score
   (`assurance/index.ts:24-37`, test asserts `!('score' in report)`). Production
   high-risk missing owner/evals/policies fails (`assurance/index.test.ts:30-47`).

5. **Policy foundation.** `evaluatePolicy` in `packages/core/src/governance/policy.ts`.
   Conditions and requirements match the spec. Grep: no production import
   outside tests.

6. **Database.** `agents`, `discovery_runs`, `assurance_runs` in both
   `schema.ts:265-307` and `sql.ts:100-118`. `events.agent_id` optional
   (`schema.ts:86`, `sql.ts:32`, `MIGRATIONS`). Named queries present, org-scoped,
   isolation tests in `agents.test.ts:63-92`. Existing ingest path still accepts
   events without `agentId` (`agents.test.ts:138-157`).

7. **Control UI.** `requireOrg()` on `/discover`, `/agents`, `/assurance`,
   `/agents/[id]`. Nav order in `apps/control/src/components/nav.tsx:6-17`.
   Dashboard keeps cost-per-outcome and adds `AgentInfra`
   (`dashboard/page.tsx:183, 218-265`). Agent detail sections + CSS graph from
   the manifest (`agents/[id]/page.tsx`, `graph.tsx:4-6`). Discover form accepts
   `https://github.com/owner/repo` + branch; caps rendered from
   `GITHUB_FETCH_LIMITS`; token is `process.env.ARK_GITHUB_TOKEN` in
   `discover/actions.ts:28`.

8. **Runtime / SDK.** `RuntimeRequest.agentId` optional (`types.ts:45`).
   `emitTelemetry` copies it (`telemetry.ts:77,90,103`). SDK `EventDraft.agentId`
   and `bindAgent` (`sdk/src/index.ts:49, 195-221`). Tests for presence and
   absence.

9. **Docs.** `docs/09-agent-control-v01.md`; updates to `01`, `03`, `04`, `08`,
   `README.md`, `.env.example`. No new app, no Runtime surface, no per-protocol
   dashboard.

10. **Preserve.** Consumer still has no `@ark/core` / `@ark/db` import. Protocol
    evidence path untouched. Tenancy on the new tables. Typecheck/test/build
    were not re-run in this review; scored from the tests in the diff.

Deviation `AgentRiskLevel` is declared.

---

### 2. The evidence proves it — ❌

Before was captured first (`captures.tsv:1`, commit `ac7476f`, `dirty=0`) with
the same `probe.mjs`. `EVIDENCE.md` “what this does not prove” is specific
(live GitHub, empty inventory, policy not on the request path). That part is
right.

What fails the criterion:

- `evidence/agent-control-v01/before.txt:1` — `@ark/core resolves ABSENT`. The
  package already existed on `main`. The before probe did not import the same
  compiled core the after probe used (`after.txt:1` `yes`).
- `evidence/agent-control-v01/before.txt:15-17` — `GET /discover|/agents|/assurance`
  printed `ABSENT`, which `probe.mjs:90-95` emits only when `fetch` status is 0
  (connection failed). The spec’s prove bar was **404**. After is 307/200. That
  is server-down vs server-up, not missing-route vs new-route.
- `evidence/agent-control-v01/probe.mjs:33-39` — after “discovery / assurance /
  policy = yes” is `typeof export === 'function'`. The probe never calls
  `discoverRepository`, `materializeAgentManifests`, `runAssurance`, file
  bounds, org isolation, or an `agentId` ingest round-trip — all of which
  `specs/agent-control-v01.md` “How this will be proved” said the after probe
  would record.
- `evidence/agent-control-v01/after-discover.png`, `after-agents.png`,
  `after-assurance.png` — empty Demo Co inventory. Disclosed, and not a
  substitute for a completed Discover → Register → Assure pass.

**To earn the point:** recapture with Control listening and `@ark/core`
resolving on **both** sides (before anon GET **404**, after **307** / authed
**200**). Extend `probe.mjs` so the after run actually invokes
`discoverRepository` + `materializeAgentManifests` on a fixture, `runAssurance`
on a production high-risk missing-owner manifest (expect `fail`), and a bounded
GitHub URL / file-cap assertion. Recapture `after.txt`. A screenshot of a
registered agent / assurance report would make the user outcome visible; empty
forms alone do not.

---

### 3. The structure holds — ✅

Control pages already import `@ark/db`; the new routes do the same
(`discover/page.tsx:6`, `agents/page.tsx:7`, `assurance/page.tsx:2`,
`discover/actions.ts:12-18`). Services take snapshots and manifests, not
`NextRequest`. `@ark/core` gained no dependency beyond existing `zod`
(`packages/core/package.json:14`). `fetchGithubSnapshot` takes `fetchFn`
(`github.ts:103-110`) so tests never hit the network.

---

### 4. It fails safely — ✅

New external call: `github.ts:119-127` aborts at `timeoutMs` (8s). 404 / 401 /
403 / other non-OK become operator-facing strings without the token
(`github.ts:131-135`). `discover/actions.ts:51-54` catches and redirects to
`?error=`. Snapshot JSON is asserted not to contain the token
(`github.test.ts:102`). File and total byte caps skip oversized blobs
(`github.ts:166-179`). `scan.ts` has no `eval` / dynamic import / shell.
`parseGithubRepoUrl` rejects non-github hosts (`github.test.ts:28-32`). Every
new SELECT is `WHERE org_id=?`. Ingest without `agentId` still writes
(`ingest.ts:101`, `agents.test.ts:138-157`).

---

### 5. The next person can read it — ✅

Layout matches the spec (`packages/core/src/agents|discovery|assurance|governance`,
`packages/db/src/agents.ts`, Control routes). Comments explain why (no invented
edges, token stays with the caller, unknown is not pass). Tests sit next to the
code they pin. No debug leftovers, no commented-out blocks.

---

### Non-blocking

- `packages/core/src/discovery/github.ts:139-153` downloads the full recursive
  tree JSON, then slices to 400 paths. Content fetches are sequential, each with
  an 8s budget (`github.ts:159-183`), so a slow GitHub can hold the server
  action for minutes. An overall deadline (and failing closed before `json()` on
  a truncated/huge tree) would match the spec’s “fail closed on oversized trees”
  more literally.
- `apps/control/src/app/discover/actions.ts:62` — `owner` from `FormData` is not
  passed through `AgentManifest` / a max-200 string before `upsertAgent`.
  Environment is `safeParse`’d on the next lines; owner should be too.
- `packages/db/src/agents.ts:40` — `JSON.parse` of `manifest` is unvalidated on
  read. Re-parse with `AgentManifest.safeParse` (and a page-level unknown state)
  would stop a corrupt row from 500’ing `/agents/[id]`.
- `packages/core/src/discovery/scan.ts:307` stores MCP `command` / `url` as
  `source`. A secret-looking token in that string would persist, unlike `.env`
  assignments which are names-only.
- `packages/db/src/agents.ts:374-383` — `latestAssuranceByAgent` is “first
  unique agentId in the last 100 runs”, not latest-per-agent over the full
  table.
- `apps/control/src/app/dashboard/page.tsx:18` — when the org has zero traces
  **and** zero agents, `Empty()` returns before `AgentInfra`. Demo Co has traces
  so the screenshot still shows the block.
- `evidence/agent-control-v01/captures.tsv:2` stamps after as `a2a0000 dirty=3`
  (the evidence files themselves). Harmless once committed.
- `evidence/agent-control-v01/shots.mjs:31` logs in as Demo Co;
  `probe.mjs:102` as Northwind. Both empty of agents; declared.
- Nav label “Calibration” clips to “Calibr.” at 1440px (`after-discover.png`).
  Pre-existing squeeze, now three items worse.
