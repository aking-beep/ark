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

## Round 2 — 2026-10-01 — 5/5

Reviewed from `specs/agent-control-v01.md`, `evidence/agent-control-v01/`, and
`git diff main...HEAD` only. No build transcript was read. Evidence was opened
before the diff. Round 1 is left intact; this scores the artifacts in front of
this round, not the trend.

From the artifacts alone, a user can now: sign in to Control and open
**Discover** (GitHub URL + optional branch, documented fetch caps), **Agents**
(org registry showing registered **Support triage**, production, high, latest
assurance **fail**), and **Assurance** (1 assessed, 0/0 pass/warn, 1 fail, 0
unknown, with findings: no evaluation refs, no policy refs, high-risk production
without approvalRequired); open **`/agents/support-agent`** and see overview,
source, models, tools, MCP, integrations, permissions, data, policies,
evaluations, an infrastructure graph, and a full assurance table; see an
**Agent infrastructure** block on Spend (1 registered, 1 production, 1 failing,
0 observed). Anon hits on those routes redirect to login (307). `@ark/core`
actually ran `discoverRepository` on a LangGraph/OpenAI/MCP fixture (confidence
0.8), left owner unknown on materialize, failed assurance on a production
high-risk missing-owner manifest, and capped discovery files at 40. A giant
purpose is rejected. `agents` DDL exists. `RuntimeRequest.agentId` is optional.

Those artifacts do **not** show a live GitHub Discover click (the registered
agent is a fixture upsert, declared in `EVIDENCE.md`). Policy is not on the
request path.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All ten acceptance criteria are met in the diff as written. `AgentRiskLevel` rename is declared in `EVIDENCE.md`. |
| 2 | Evidence proves it | ✅ | Same probe command twice. After now *calls* discovery, materialize, assurance, and the file cap. Screenshots show a registered agent, a fail report, and `/agents/support-agent`. Honest “does not prove”. Before HTTP remains ABSENT (status 0), not 404 — noted, not a withhold on this round. |
| 3 | Structure holds | ✅ | Edge pages call `@ark/db` the same way the rest of Control does. Scan/materialize/assurance/policy are typed core functions, not framework `Request` types. GitHub `fetch` is injected. No new npm dependency. |
| 4 | Fails safely | ✅ | GitHub calls have an 8s `AbortController` and a 20s overall budget; 404/401/403 become form errors; token stays in env and out of the snapshot JSON; snapshots are capped; scanned source is not `eval`’d. Org-scoped reads. `agentId` omit still ingests. |
| 5 | Readable | ✅ | Packages and routes match the spec paths. Comments say why. Tests live next to the logic they pin. |

**Blocking:** none.
**Non-blocking:** findings below the criterion notes.

---

### 1. It does what the spec said — ✅

1. **Agent Manifest.** `packages/core/src/agents/manifest.ts` is Zod, bounded
   (`id` 128, `purpose` 2_000, array caps), closed enums, optional owner /
   policy / data. Exported from `packages/core/src/index.ts:18`. Tests cover
   parse, giant purpose, required identity (`manifest.test.ts`).

2. **Repository discovery.** `discoverRepository` takes `RepoSnapshot`
   (`scan.ts:10-16`, max 40 files × 64 KB). No clone, exec, or install. Result
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
   (`dashboard/page.tsx:190, 225-269`). Agent detail sections + CSS graph from
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

### 2. The evidence proves it — ✅

Opened `evidence/agent-control-v01/` first. A reader who has not seen the diff
can answer what a user can do now: register an Agent Manifest, see it on
`/agents`, fail ARK Assurance on a production high-risk agent, and inspect the
detail graph. That is the spec outcome.

Same command twice (`node evidence/agent-control-v01/probe.mjs`). Before was
captured first (`captures.tsv:1`, commit `ac7476f`, `dirty=0`). After recapture
is `captures.tsv:3` (`d0bcd8b`, then committed). `EVIDENCE.md` “what this does
not prove” is specific (live GitHub unset, fixture upsert not a Discover click,
policy not on the request path).

Round 1 withheld this point because the after probe was `typeof === 'function'`
only, the screenshots were empty inventory, and Discover → Register → Assure
was not in the artifacts. This round’s after probe **calls** the functions:

- `evidence/agent-control-v01/probe.mjs:76-104` — `discoverRepository` on a
  LangGraph/OpenAI/MCP fixture; `after.txt:11` `yes (confidence 0.8)`.
- `probe.mjs:99-101` — `materializeAgentManifests`; `after.txt:12` owner stays
  unknown.
- `probe.mjs:107-116` — `runAssurance` on production high-risk missing owner;
  `after.txt:13` `yes`.
- `probe.mjs:118-124` — `selectDiscoveryFiles` cap 40; `after.txt:14` `yes`.
- `probe.mjs:173-178` — authed `GET /agents/support-agent` 200 and the body
  names Support triage; `after.txt:25-26`.

Screenshots at 1440×900: `after-agents.png` shows Support triage registered with
assurance **fail**; `after-assurance.png` shows counts and fail findings;
`after-agent-detail.png` shows the graph, inventory, and check table;
`after-dashboard.png` shows Agent infrastructure 1/1/1/0; `after-discover.png`
shows the GitHub form and documented caps.

Remaining weaknesses that do **not** meet a withhold condition: before HTTP is
still `ABSENT` (`before.txt:15-17`, `probe.mjs:145` emits ABSENT only on status
0). Recapturing it after the edit would reconstruct the baseline. Org isolation
and an ingest `agentId` round-trip are in `packages/db/src/agents.test.ts:63-157`,
not in the probe. The registered screenshot agent is a fixture upsert
(`shots.mjs:31-32`), declared.

**Measured the same way:** same probe path, same Control port, same 1440×900
viewport for shots. The probe gained invocation lines after the baseline; those
lines would have printed ABSENT on `ac7476f` had they existed then. The original
25 before keys still map ABSENT → yes/307/200.

---

### 3. The structure holds — ✅

Control pages already import `@ark/db`; the new routes do the same
(`discover/page.tsx:6`, `agents/page.tsx:7`, `assurance/page.tsx:2`,
`discover/actions.ts:12-18`). Services take snapshots and manifests, not
`NextRequest`. `@ark/core` gained no dependency beyond existing `zod`
(`packages/core/package.json:14`). `fetchGithubSnapshot` takes `fetchFn`
(`github.ts:104-112`) so tests never hit the network. Third-party GitHub HTTP
is constructed in the github adapter, not in a page.

---

### 4. It fails safely — ✅

New external call: `github.ts:121-131` aborts at `timeoutMs` (8s). Overall
budget `GITHUB_FETCH_LIMITS.overallMs` (20s) is checked before each get and
inside the file loop (`github.ts:111, 122, 163-166`). 404 / 401 / 403 / other
non-OK become operator-facing strings without the token (`github.ts:134-138`).
`discover/actions.ts:51-54` catches and redirects to `?error=`. Snapshot JSON
is asserted not to contain the token (`github.test.ts:102`). File and total
byte caps skip oversized blobs (`github.ts:173-187`). `scan.ts` has no `eval` /
dynamic import / shell. `parseGithubRepoUrl` rejects non-github hosts
(`github.test.ts:28-32`). Every new SELECT is `WHERE org_id=?`. Ingest without
`agentId` still writes (`ingest.ts:101`, `agents.test.ts:138-157`). Corrupt
stored manifests `safeParse` and skip/null rather than 500 the list
(`agents.ts:31-37, 63-67, 79-83`). MCP `command`/`url` that look like secrets
are dropped (`scan.ts:446-450`).

---

### 5. The next person can read it — ✅

Layout matches the spec (`packages/core/src/agents|discovery|assurance|governance`,
`packages/db/src/agents.ts`, Control routes). Comments explain why (no invented
edges, token stays with the caller, unknown is not pass). Tests sit next to the
code they pin. No debug leftovers, no commented-out blocks.

---

### Non-blocking

- `evidence/agent-control-v01/before.txt:15-17` — anon GET printed `ABSENT`
  (fetch status 0). The spec’s prove bar was 404. Honest, and the after 307/200
  plus screenshots carry the comparison now.
- `evidence/agent-control-v01/probe.mjs` still does not record org isolation or
  an ingest `agentId` round-trip (spec “How this will be proved”). Those live in
  `packages/db/src/agents.test.ts:63-157`.
- `evidence/agent-control-v01/shots.mjs:31-32` upserts the screenshot agent;
  it is not a Discover form submit. Declared in `EVIDENCE.md`.
- `packages/core/src/discovery/github.ts:145-150` still `json()`s the recursive
  tree before slicing to 400 paths. Fail-closed on a huge truncated payload
  would match the spec’s “fail closed on oversized trees” more literally.
- `packages/db/src/agents.ts:188` / `:234` — `JSON.parse` of discovery `result`
  and assurance `report` is not `safeParse`’d. A corrupt run row can still 500
  `/discover?run=` or `/assurance`. Manifest reads already validate.
- `apps/control/src/app/discover/actions.ts:62` — `owner` is `.slice(0, 200)`,
  not `AgentManifest.shape.owner.safeParse`. Environment on the next lines is.
- Nav label “Calibration” clips to “Calibr.” at 1440px (`after-discover.png`).
  Pre-existing squeeze, now three items worse.
- `evidence/agent-control-v01/captures.tsv:3` stamps the recapture `dirty=15`
  (evidence files themselves). Harmless once committed.
