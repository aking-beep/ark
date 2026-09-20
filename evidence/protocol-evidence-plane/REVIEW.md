# Review — protocol-evidence-plane

## Round 1 — 2026-09-20 — 4/5

Reviewed from `specs/protocol-evidence-plane.md`, `evidence/protocol-evidence-plane/`
and `git diff main...HEAD` only. No build transcript was read. Claims were
re-verified independently: `npm run typecheck` (exit 0), `npm run test`
(267/267 across ten suites, matching the evidence), `npm run build` (exit 0,
`/protocols` present in the route manifest), direct queries against
`/workspace/ark.db`, and a reviewer-written probe exercising the six adapters,
the three redaction layers, idempotency, the tenancy boundary and the
`approval_missing` condition matrix.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All ten acceptance criteria met as written. Two out-of-spec changes, both declared in `EVIDENCE.md` § Deviations. |
| 2 | Evidence proves it | ✅ | Before captured at `646fe6f` prior to the first line of feature code; same probe script, same viewport, same routes, same org; four pre-existing counters carried as regression canaries; "what this does not prove" is specific and unflattering. |
| 3 | Structure holds | ✅ | Edge → service → adapter holds. No new third-party dependency. `@ark/core` does not depend on `@ark/protocols`; no cycle. |
| 4 | Fails safely | ❌ | `packages/db/src/ingest.ts:245` writes caller-supplied metadata **key names** verbatim into a persisted `alerts.message`, so the redaction path is itself a channel for storing untrusted caller text. `packages/db/src/queries.ts:447` and `:527` join `workloads` without scoping on `org_id`, so an org-scoped query function returns another tenant's workload name. |
| 5 | Readable | ✅ | Comments explain why, not what; 106 new tests written alongside and mapped to the spec's criteria; no debug output, no commented-out code. |

**Blocking:** criterion 4 (findings 1 and 2).
**Non-blocking:** findings 3–7.

---

### 1. It does what the spec said — ✅

Each criterion checked against the code and, where observable, against the
running system.

1. **Canonical grain, not the model-event grain.** `packages/core/src/ingest/evidence.ts:61-104`
   declares `EvidenceInput` with exactly the nineteen fields the spec names, in
   the spec's own optionality. `protocol` is the six-member enum
   (`evidence.ts:18`). Metadata is scalars-only, ≤32 keys, ≤200-character
   strings (`evidence.ts:42-58`); I confirmed by probe that a nested object, an
   array, a 33rd key and a 201-character value are each a parse failure, not a
   flattening. `protocol_evidence` exists in the Drizzle schema
   (`packages/db/src/schema.ts:107-166`) and in the plain DDL
   (`packages/db/src/sql.ts:43-59`); I diffed the two column-by-column and
   index-by-index and they agree, including the four required indexes, which
   `sqlite_master` confirms are present in `ark.db`. Nothing reaches `events`:
   the evidence loop (`packages/db/src/ingest.ts:200-238`) writes only `traces`
   and `protocol_evidence`, my probe recorded 0 rows in `events` after posting
   evidence, and the live database still holds 12,315 events.

2. **`@ark/protocols` cannot carry a payload.** All six adapters are exported and
   return `NormalisedEvidence`. The allowlist claim is the load-bearing one and
   it holds. `packages/protocols/src/types.ts:84-116` assembles the output key
   by key from `Resolved` and from eleven named fields on `ObservationBase`;
   nothing is spread from the caller. I probed each adapter in plain JavaScript
   with `arguments`, `args`, `params`, `content`, `structuredContent`,
   `messages`, `message`, `delta`, `snapshot`, `result`, `dataModel`,
   `a2uiClientDataModel`, `buyer`, `line_items`, `payment`, `instruments`,
   `signature`, `checkout_jwt`, `disclosures`, `cnf`, `payment_instrument`,
   `credential` and `_meta` attached at the top level: **not one appears in the
   serialisation of any of the six.** The only fields that carry a caller string
   through are the ones the adapters exist to record (`method`, `name`, `agent`,
   `surfaceId`, `catalogId`, `components`), which is the documented design.
   Spec versions are recorded per file (`mcp.ts:22`, `a2a.ts:19`, `ag-ui.ts:24`,
   `a2ui.ts:25`, `ucp.ts:25`, `ap2.ts:27`) and the official vocabularies are
   exported verbatim. `packages/core/package.json` depends on `zod` alone, so
   the direction is right and there is no cycle.

3. **Redaction at the ARK boundary.** `redactEvidence` is exported
   (`evidence.ts:228`), the SDK applies it before the POST
   (`packages/sdk/src/index.ts:181`, asserted by `index.test.ts:115`) and
   `applyIngest` applies it again before the INSERT (`ingest.ts:205`). The
   criterion as written is met. What ingest *reports* is where finding 1 sits;
   see criterion 4.

4. **Ingest, idempotently, under the existing auth.** `evidence[]` is in
   `IngestBody` (`packages/core/src/ingest/schema.ts:92`) and the at-least-one
   refinement counts it (`schema.ts:108`). An evidence-only body parses; an
   empty body still does not. `INSERT OR IGNORE` on the primary key makes a
   re-post a no-op — probe: one row after two posts. The org check at
   `apps/control/src/app/api/v1/events/route.ts:29-31` is untouched and
   `orgId: caller.orgId` is forced at `:34`. `EvidenceInput` is a non-strict
   `z.object`, so I confirmed an `orgId` (or `org_id`) placed inside an evidence
   element is stripped at parse and cannot reach the INSERT. `GET` documents two
   evidence examples (`route.ts:74-93`).

5. **`approval_missing`.** `approvalMissingAlert` (`ingest.ts:325-341`). I drove
   all six outcomes through it: it fires on `ok` and `approved` and stays silent
   on `pending`, `error`, `blocked` and `denied`. The severity ladder measured
   `low=info medium=warn high=critical critical=critical`, exactly as specified.
   The alert id is `al_apprmiss_${e.id}` (`ingest.ts:334`) and two posts of the
   same evidence produced one alert row.

6. **SDK correlation.** `TraceHandle.evidence()` sits beside the other four
   recorders (`packages/sdk/src/index.ts:174-183`) and defaults both the trace
   id and the workload to the handle's. See non-blocking finding 5 on the trace
   id override.

7. **Protocols page.** Nav item added (`apps/control/src/components/nav.tsx:9`).
   Built from existing `@ark/ui` primitives, no new design system. The four
   headline metrics, the eight per-protocol card figures and the seven table
   columns are all present and are the ones the spec names. The empty state is
   a real page: `after-pages.txt` records `200 /protocols` for Northwind and
   `after-protocols-empty.png` shows it.

8. **One trace across grains.** `TraceStoryPanel`
   (`apps/control/src/app/workloads/[id]/page.tsx:201-262`) renders model calls
   with cost, then protocol evidence, then actions, then the outcome — the
   spec's order — from `traceStory`, which reads four tables joined on one trace
   id. Visible in `after-workload.png`.

9. **Seeded demo data.** Verified against `ark.db`: 321 observations over 120
   traces, MCP 157 / A2A 49 / AG-UI 46 / A2UI 26 / AP2 22 / UCP 21, and exactly
   one `approval_missing` alert, at `critical`, naming the AP2 payment mandate
   from `procurement-agent` to `aws`. 24 rows are `pending` with
   `required_approval=1` and no approver and correctly raise nothing. No row's
   `ts` is in the future. The seed posts through `applyIngest` and throws if
   redaction fires (`packages/db/src/seed.ts:449-451`), which is a good guard.

10. **Nothing that worked stops working.** typecheck, test and build all exit 0,
    verified here. `git diff main...HEAD --numstat -- '*.test.ts'` shows ten
    files, all additions, zero deletions, so the 161 pre-existing tests are
    unmodified. No new external dependency: the only `package-lock.json` changes
    are workspace links.

**On out-of-spec scope.** Two changes the spec did not ask for — the `fmt.when`
clamp at `packages/ui/src/primitives.tsx:446`, which touches a shared primitive
used by other pages, and the seed's `started_at BETWEEN ? AND ?` bound — are
both declared in `EVIDENCE.md` § Deviations with their reasoning, which is what
build rule 7 requires. Neither is substantial. The point stands.

### 2. The evidence proves it — ✅

`captures.tsv` records the before probe at `646fe6f`, and `git log main..HEAD`
confirms that commit is the spec, one commit before the first `feat` commit —
the baseline is a baseline, not a reconstruction. Before and after were produced
by the same `probe.mjs` against a scratch database built from the repo's own
`DDL`, and the screenshots by the same `shots.mjs` at a hard-coded
`{ width: 1440, height: 900 }`, logging in as the same seeded org and visiting
the same four routes; all nine PNGs are 1440 wide. The probe deliberately
re-measures four pre-existing behaviours (unpriced model events, `loop_runaway`,
`unapproved_action`, prompt-sample scanning) and those four lines are
byte-identical between `before.txt` and `after.txt`, so a regression in the old
grain would have shown up as a changed line.

The evidence is not only tests: `before-protocols.png` is a 404 and
`after-protocols.png` is a populated page, and a reader who has not seen the
diff can answer "what can a user do now" from the artefacts alone — post
protocol observations through the existing ingest endpoint and see, per
protocol, what ran, what was blocked, which required approvals are missing and
how much money was acted on.

"What this does not prove" is the strongest part of the submission and is
neither empty nor evasive: no protocol was actually spoken; redaction is proved
only against the payloads the builder thought to try, with `operation`, `actor`
and `target` named as free strings a determined caller can abuse; one browser,
one viewport, one machine, SQLite only; seeded rather than production shapes;
and the value de-duplication is identified as a judgement that will under-count
a trace with two genuine payments. I reproduced the substantive claims
independently and found them accurate, including the per-protocol counts and
the single `approval_missing` alert.

Minor: `captures.tsv` records `dirty=9` for the after capture. The tree is clean
at the tip and the evidence is committed, so this is noise, but a clean capture
would be better.

### 3. The structure holds — ✅

Edge does not touch an adapter. `apps/control/src/app/protocols/page.tsx:2`
imports `protocolSummary` and `recentEvidence` as functions and writes no SQL
and constructs no client; the same is true of the workload page's
`richestProtocolTrace` / `traceStory`. This matches the pre-existing convention
of every other page in the app (`dashboard/page.tsx:2`, `budgets/page.tsx:1`).
The ingest route only authorises, parses and calls `applyIngest`
(`route.ts:11-49`). `@ark/db` remains the only place `raw()` is called.

Services import no framework types: `@ark/core`'s evidence module and all six
adapters import nothing beyond `zod` and each other, and `@ark/protocols` has
no I/O of any kind. The layer direction is clean — `@ark/protocols` → `@ark/core`,
`@ark/db` → both, `apps/control` → all three — and `@ark/core` imports nothing
from `@ark/protocols` (the only matches are in prose comments).

No new dependency the spec did not authorise. `packages/protocols/package.json`
lists `@ark/core` alone; no protocol SDK was pulled in, and `EVIDENCE.md`
declares that choice and why.

### 4. It fails safely — ❌

Much of this is done well and should be said: the adapters are pure functions
with no network call to time out; a malformed body is a 422 with issues rather
than a hang; an org with no evidence gets the empty state rather than a crash
(`protocols/page.tsx:20`); `parseMetadata` (`queries.ts:481-489`) swallows a
corrupt JSON blob into `{}` so the page cannot throw on `e.metadata.amount`;
`pending` is modelled explicitly so the new detection does not page somebody for
every in-flight approval; and the seed refuses to complete if redaction fires.

Two things cost the point, and both are on the new code's own trust boundary.

**Finding 1 (blocking) — `packages/db/src/ingest.ts:245`.** The
`sensitive_data` alert raised when ingest has to redact something interpolates
the caller's metadata **key names** verbatim into `alerts.message`, which is
persisted and rendered to operators on `/budgets` and `/dashboard`. Metadata
keys are caller-controlled free text of up to 64 characters
(`packages/core/src/ingest/evidence.ts:44`), and `isDeniedKey`
(`evidence.ts:171-174`) matches by suffix, so a key is reported verbatim
whenever it merely *ends* in a denied word. I confirmed by probe that posting

```
metadata: { "victim.bob@example.com_token": "x" }
```

results in `alerts.message` containing `victim.bob@example.com_token` — an email
address, one of the six patterns `detectSensitive` exists to catch, written to
the database by the very control that claims to have stopped it. The redaction
path is therefore a working channel for persisting arbitrary caller text, which
is the single failure mode the feature was built to prevent. It also contradicts
the code's own contract at `evidence.ts:190-191` ("Returns the keys removed.
Never the values — a control that logs the payload it found in order to warn you
about the payload is not a control") and the spec's criterion 3 ("Ingest reports
what class of thing was redacted, never the value").

To earn the point back: report from a bounded vocabulary instead of the caller's
string. `redactMetadata` already knows *why* it dropped each entry — the matched
`DENIED_METADATA_KEYS` entry, the `detectSensitive` label, or "non-scalar" — and
any of those three is a fixed set safe to persist. A count plus classes
("2 fields dropped: payload name, email") satisfies the spec's "class of thing"
and closes the channel. If the raw key is genuinely useful to a developer, it
can stay in the HTTP response (`evidenceRedacted`, `ingest.ts:270`), which goes
back only to the caller that sent it and is not stored.

**Finding 2 (blocking) — `packages/db/src/queries.ts:447` and `:527`.** Both
evidence reads join `workloads` on `w.id = p.workload_id` with no
`AND w.org_id = p.org_id`. `p.workload_id` is unvalidated caller input — nothing
checks that an evidence row's `workloadId` belongs to the posting org — so the
join key crosses the tenancy boundary. I confirmed by probe that an evidence row
written under `org_b` naming `org_a`'s workload id causes `recentEvidence` (an
org-scoped function, part of `@ark/db`'s public API) to return
`workloadName: "Project Redacted - M&A due diligence"`, i.e. another tenant's
workload name. The storage boundary is sound — `applyIngest` forces the bearer's
org and strips any `orgId` inside the evidence — but the read boundary is not,
and the org-isolation test at `packages/db/src/evidence.test.ts:242` asserts only
the storage half, which is why this was not caught.

Nothing renders `workloadName` today, so this is not a live disclosure; it is an
unvalidated cross-tenant read behind a public function, waiting for its first
consumer. To earn the point back: add `AND w.org_id = p.org_id` to both joins,
or delete `EvidenceRow.workloadName` (`queries.ts:439`, `:474`) since no caller
reads it. The identical unscoped join at `queries.ts:242` is pre-existing and
*is* rendered; per the scope rule that belongs in its own spec, not this diff.

### 5. The next person can read it — ✅

The comments earn their place. They explain decisions a reader would otherwise
have to reverse-engineer and they are honest about trade-offs rather than
flattering: why `pending` is load-bearing (`evidence.ts:27-31`), why the
denylist is "the weakest of the three" layers (`evidence.ts:126-129`), why the
value headline takes the maximum per trace and what that under-counts
(`queries.ts:299-311`), why median rather than mean latency, why
`missingApprovals` is recomputed from evidence rather than counted from alerts
("counting alerts would let the number be cleared by reading it"), and why each
adapter records the spec revision it was built against. Names say what they
mean; `EvidenceObservation` vs `EvidenceInput` vs `NormalisedEvidence` is a real
distinction and the type comments state it.

Tests were written in the same pass and test the spec rather than the
implementation. `packages/protocols/src/redaction.test.ts:20-55` is the right
shape for the central claim: a table of twenty-three payload field names driven
through all six adapters, asserting the absence of the payload string in the
serialisation — a property test, not six examples. `packages/db/src/evidence.test.ts`
covers each of the `approval_missing` conditions separately, including the two
negatives. The change is where a reader would look for it, and the new docs
(`docs/07-protocol-evidence.md`, `docs/adr/0007-...`) plus the updates to
`docs/01-architecture.md` and `docs/03-data-model.md` mean the fourth grain is
discoverable without the diff.

No dead code of consequence, no commented-out code, no debug output, no `TODO`.
The exported protocol vocabularies are not dead — criterion 2 required them
verbatim. The one unused field is `EvidenceRow.workloadName`, named in finding 2.

---

## Non-blocking notes

3. **`packages/core/src/ingest/evidence.ts:134-165` — the denylist misses
   plausible payload key names.** Sixteen of sixteen names I tried survived
   redaction: `toolInput`, `userText`, `msg`, `requestBlob`, `resultData`,
   `note`, `memo`, `detail`, `freeform`, `comment`, `reason`, `description`,
   `summary`, `userMessage`, `promptText`, `argsJson`. The suffix rule only
   catches payload words at the *end* of a key, so `toolArgs` is caught but
   `argsJson` and `promptText` are not. This is not a withheld point: the spec
   asked for a denylist, a denylist is what was built, the code says in place
   that this layer is the weakest of the three, and `EVIDENCE.md` declares the
   limit explicitly. Cheapest improvement is to match payload words as a
   *substring* of the normalised key rather than as whole word or suffix, with
   the existing `keeps honest metadata` test (`evidence.test.ts:80`) as the
   guard against over-matching.

4. **`packages/db/src/ingest.ts:244` — the redaction alert names the wrong
   workload.** `evidence.find((e) => e.workloadId)?.workloadId` attributes the
   alert to the first row in the batch that happens to carry a workload, not to
   the row that carried the redacted key. In a 1000-row batch that points an
   operator at the wrong workload, which undercuts the observability claim in
   `EVIDENCE.md` ("a mis-integrated client is visible rather than silent" — it
   is visible, but misattributed). Either raise one alert per offending row, or
   drop `workloadId` to `null` and say "across this batch".

5. **`packages/sdk/src/index.ts:179` — `evidence()` lets the caller override the
   trace id; `event()` does not.** `event()` forces `traceId: this.traceId`
   (`index.ts:145`), whereas `evidence()` uses
   `observation.traceId ?? this.traceId`. Since `ObservationBase` carries a
   `traceId`, an adapter result can silently re-point evidence recorded on one
   handle at a different trace. The spec's criterion 6 grants an override for
   the workload only. The default behaviour is correct, so this costs nothing,
   but the two methods reading differently will confuse the next reader.

6. **`packages/protocols/src/a2ui.ts:80` — `components` is not checked against
   the catalogue.** `vocabulary(o.components)` joins whatever strings it is
   given into `metadata.componentTypes`, so form values passed as component
   names are stored (capped at 200 characters, and only if they trip no
   detector). `A2UI_BASIC_CATALOG_COMPONENTS` is already exported at `:43`;
   filtering against it, or against `/^[A-Za-z][A-Za-z0-9]{0,31}$/`, would make
   the field's contract enforced rather than documented.

7. **`packages/db/src/ingest.ts:200-238` — the evidence loop is not wrapped in a
   transaction**, so a failure mid-batch leaves earlier rows written. This is
   the pre-existing pattern for events, actions and quality samples, and the
   idempotent primary key means re-posting the batch converges, so there is a
   way back; noting it only because the batch cap is 1000 rows, which is larger
   than the other grains' 500.

8. **`packages/db/src/queries.ts:337-344` issues one query per protocol for the
   value figure** (seven queries total on the page, not four as `EVIDENCE.md`
   says). Bounded at six protocols and indexed, so it does not matter at this
   size; `GROUP BY protocol` over the same de-duplicating subquery would fold it
   into one.

## Round 2 — 5/5

Reviewed independently of round 1's verdict and of the builder's claims.
Inputs: `specs/protocol-evidence-plane.md`, `evidence/protocol-evidence-plane/`
(read first), `git diff main...HEAD`. Claims were re-measured, not trusted:
`npm run typecheck` (exit 0), `npm run test` (284/284, 0 fail), a fresh run of
`probe.mjs` byte-identical to `after.txt`, a fresh run of `findings.mjs`
byte-identical to `after-findings.txt`, sqlite against `/workspace/ark.db`,
HTTP fetches of every Control route as both demo orgs, and a reviewer-written
probe that posted the round-1 inputs and then dumped **every table** looking
for the caller strings.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All ten acceptance criteria still hold. The one test that changed was wrong (it required the leak); the correction is declared in `EVIDENCE.md` § Deviations. |
| 2 | Evidence proves it | ✅ | Before captured at `646fe6f` before any feature code; same probe, same viewport, same routes; round-2 findings have their own after-state whose before-state is round 1's `REVIEW.md`; "what this does not prove" is still specific. |
| 3 | Structure holds | ✅ | Edge → service → adapter holds. No new third-party dependency. `@ark/core` still does not import `@ark/protocols`. |
| 4 | Fails safely | ✅ | The two withheld channels are closed: denied metadata keys do not appear in any persisted column, and both evidence reads scope the workload join on `org_id`. Remaining notes below are either pre-existing (parked in round 1) or the documented free-string fields. |
| 5 | Readable | ✅ | The round-2 comments explain why the alert reports classes and why the join carries `org_id`. Tests were strengthened, not weakened. |

**Blocking:** none.
**Non-blocking:** notes 1–3.

---

### 1. It does what the spec said — ✅

Re-checked against the spec as written, after commit `892ac03`.

1. **Canonical grain.** `EvidenceInput` still has the nineteen fields
   (`packages/core/src/ingest/evidence.ts:61-104`). `protocol_evidence` is in
   both Drizzle (`packages/db/src/schema.ts:121-167`) and DDL
   (`packages/db/src/sql.ts:46-59`) with the four indexes. Live `ark.db`: 321
   evidence rows, 12,315 events — no protocol observation in `events`.

2. **`@ark/protocols` cannot carry a payload.** Independent serialisation of
   `a2uiEvidence` handed `bob@example.com` / a PAN / a sentence as component
   types stored `Card,MyOrgChart` and counted 3 rejects; the form values are
   not in the JSON. `@ark/core` still has no `protocols` import.

3. **Redaction at the ARK boundary.** SDK still redacts before POST
   (`packages/sdk/src/index.ts:184`); ingest still redacts before INSERT
   (`packages/db/src/ingest.ts:205`). Ingest now reports **classes** in the
   persisted alert and **key names** only in `evidenceRedacted` on the HTTP
   result, which `POST /api/v1/events` returns after stripping `alertRecords`
   (`apps/control/src/app/api/v1/events/route.ts:43-50`). Spec criterion 3
   asked for class, never the value. That holds.

4. **Ingest, idempotently, under existing auth.** Untouched in substance.
   Org still forced from the bearer.

5. **`approval_missing`.** Still fires on `ok`/`approved` only, severity
   follows risk, id is `al_apprmiss_${e.id}`. Live DB has exactly one row,
   `critical`, naming the AP2 mandate.

6. **SDK correlation.** `TraceHandle.evidence()` now forces
   `traceId: this.traceId` (`packages/sdk/src/index.ts:181`), matching
   `event()`. Workload remains overridable. Probe: posting `traceId:
   'tr_somewhere_else'` on handle `tr_real` stored `tr_real`.

7. **Protocols page.** Screenshot and a live fetch both show 321 observations,
   the four headlines, six cards, the seven columns, and Northwind's empty
   state (200, not 500).

8. **One trace across grains.** `after-workload.png` and a live fetch of
   `/workloads/wl_support_triage` both render the ordered story.

9. **Seed.** Live counts still MCP 157 / A2A 49 / AG-UI 46 / A2UI 26 / AP2 22
   / UCP 21, one `approval_missing`. Seed still throws if ingest redacts
   (`packages/db/src/seed.ts:445-446`).

10. **Nothing that worked stops working.** typecheck and the 284 tests pass.
    `git diff main...HEAD --numstat -- '*.test.ts'` is additions-only versus
    `main`; the only pre-existing test file touched is
    `packages/sdk/src/index.test.ts`, which **appends** cases after the
    original three. Spend, Workloads, Optimise, Budgets, Calibration all
    return 200 for the demo org; Northwind's foreign workload URL is 404.
    Runtime is still a package.

    A Control fetch of `http://localhost:3001/` returned 500 with
    `Cannot find module './901.js'` under `apps/business/.next`. This branch
    does not touch `apps/business`; that is a stale Next chunk, not a feature
    regression, and `after-platform.txt` recorded 200 while the server was
    freshly started.

**On the one test that changed.** Round 1's
`packages/db/src/evidence.test.ts` asserted
`assert.match(message, /toolArguments/, 'the alert names the key')`. That
locked in the leak. `892ac03` replaces it with a block that asserts the
alert names the class, that the caller key is absent from `alerts.message`,
that `detectSensitive` is silent on the message, and that `bob@example.com`
appears nowhere in the alerts table. Three cases that used `note` as an
innocent key now use `stepName`, because `note` is denied after the
finding-3 widening and those tests were exercising the **value** detector.
`EVIDENCE.md` § Deviations declares this. It is a correction of a wrong
test, not a weakening.

**On out-of-spec scope.** Same two declared deviations as round 1 (`fmt.when`
clamp, seed `started_at` bound). The round-2 denylist widening, class
vocabulary, org predicate, forced trace id, `vocabulary()` shape check and
`GROUP BY protocol` are the round-1 findings, not silent extra product
scope.

### 2. The evidence proves it — ✅

From the artefacts alone, before reading the diff: an operator can post
protocol observations through the existing ingest endpoint and see, on
`/protocols`, which protocols ran, what was blocked, which required
approvals are missing, and how much money was acted on; a workload page
now tells that story across four grains. Before, `/protocols` was a 404
and the workload page had no protocol panel.

`captures.tsv` still records the before probe at `646fe6f` (`dirty=0`),
which `git log main..HEAD` shows is the spec commit, one before the first
`feat`. After is the same `probe.mjs` (I re-ran it; it is byte-identical to
`after.txt`, including the four pre-existing canaries). Screenshots are
still 1440×900, same four routes, same org. Round-2's `after-findings.txt`
is a separate script on purpose — `probe.mjs` was not rewritten, so its
before/after stay comparable — and its before-state is round 1's `REVIEW.md`,
which recorded the exact inputs.

"What this does not prove" is unchanged and still unflattering: no protocol
was spoken; the denylist only catches names it knows; `operation` / `actor`
/ `target` remain free strings; one browser, one viewport, SQLite; value
de-duplication is a judgement.

Minor, not a withhold: the last `after` line in `captures.tsv` is `dirty=6`
at `892ac03`. The tree is committable; a clean capture would be tidier.

### 3. The structure holds — ✅

No layer regression in `892ac03`. `redactMetadata` / classes live in
`@ark/core`; `redactionAlert` lives in `@ark/db`; `vocabulary()` lives in
`@ark/protocols`; the SDK handle change is in `@ark/sdk`. The Protocols
page still calls `protocolSummary` / `recentEvidence` and writes no SQL.
`@ark/protocols/package.json` still depends on `@ark/core` alone.

### 4. It fails safely — ✅

Round 1 withheld this on two channels. Both are closed. I did not stop at
`findings.mjs`.

**Finding 1, re-measured.** Posting
`metadata: { "victim.bob@example.com_token": "x", toolArguments: "account=999", stepName: "ping ada@example.com" }`
and then serialising every table in the scratch database: the leaky key,
`ada@example.com`, and `account=999` appear in **no** persisted column.
`alerts.message` for `al_redact_pe_leak` names the classes ("a field named
as a payload or a credential", "an email address") and
`detectSensitive(message)` is `[]`. `protocol_evidence.metadata` for that
row is `null`. The key **does** come back in `evidenceRedacted` on the
in-process result; the HTTP handler strips `alertRecords` and returns that
list to the sender only (`route.ts:43-50`). `deliverAlerts`
(`packages/db/src/alerts.ts:49-57`) would POST `a.message`, which no longer
contains the key.

`redactMetadata` (`packages/core/src/ingest/evidence.ts:250-278`) returns
`classes` from `{payload_name, non_scalar}` plus `detectSensitive` labels.
Every current detector label has an English entry in
`REDACTION_CLASS_LABELS` (`packages/db/src/ingest.ts:304-313`). The
`?? c` fallback at `:332` is unused for the vocabulary as it stands; it
would persist a snake_case label this repo owns, not the caller's string.

**Finding 2, re-measured.** Both joins now read
`LEFT JOIN workloads w ON w.id = p.workload_id AND w.org_id = p.org_id`
(`packages/db/src/queries.ts:463` and `:543`). Org_other posting evidence
that names org_demo's `wl_secret` gets `workloadName: null` from
`recentEvidence` and from `traceStory`; org_demo still resolves
`Project Redacted - M&A due diligence` on its own rows; org_demo cannot
read org_other's trace (`traceStory` filters `traces WHERE org_id=?`).

**`approvalMissingAlert` (`packages/db/src/ingest.ts:361-378`).** It
interpolates `operation`, `actor` and `target` into `alerts.message`. Those
are first-class columns on `protocol_evidence`, capped at 200 characters,
and the spec made them free strings. Putting
`operation: "payment_mandate victim.eve@example.com"` on a completed
required-approval row copies that email into the alert **and** into
`protocol_evidence.operation` — the same channel the evidence row already
opened, matching `unapproved_action` and the comment at
`ingest.ts:327-329`. It is not a remaining redaction-path leak. Live
`ark.db` has zero alert or evidence-metadata rows matching `%@%` or
`%4111%`.

**Denylist widening, over-match check.** All 16 names from round 1 now
fall. Every metadata key the six adapters actually emit — including
`componentsRejected`, which the pin-test at
`packages/core/src/ingest/evidence.test.ts:88-103` does not list — survives
`redactMetadata`. A set of keys a reasonable caller would send
(`contentType`, `tokenCount`, `promptName`, `requestId`, `statusCode`,
`isError`, `region`, `timeoutMs`, `accountId`, `userId`, `sessionId`,
`correlationId`, `httpStatus`, …) also all survive. The suffix/`args`
rules **do** drop `errorMessage`, `errorText`, `context`, `metadata`,
`maxArgs`, `nArgs`: fail-closed, and the `context`/`metadata` case is
commented at `evidence.ts:180-183`. That is the risk the change introduced,
and it did not silently strip the adapters.

**Attribution, A2UI, query count.** Redaction alerts are per observation
(`ingest.ts:207`, id `al_redact_${e.id}`); a clean first row in a dirty
batch raises nothing and the dirty row names `wl_dirty`.
`vocabulary()` (`packages/protocols/src/types.ts:165-172`) enforces
`/^[A-Za-z][A-Za-z0-9_]{0,31}$/`. `protocolSummary` issues 5 queries, one
of them `GROUP BY protocol` (`queries.ts:323-328, 338-360`).

The point is awarded because the two channels that cost it are closed, the
widening did not break the adapters, and the remaining surfaces (free-string
columns, the pre-existing alerts join) are the ones round 1 already named
as out of this spec or as documented limits.

### 5. The next person can read it — ✅

`892ac03` is a readable fix. The new comments on `redactionAlert` and on
the workload join state *why* the caller's key and the unscoped join were
unsafe, not what the next line does. The class vocabulary is a table this
file owns. Tests cover the leak (`evidence.test.ts:131-149`), the join
(`:320-342`), per-row attribution (`:151-163`), the forced trace id
(`packages/sdk/src/index.test.ts:145-171`), and `vocabulary()` rejects
(`packages/protocols/src/redaction.test.ts:129-133`). No debug output, no
commented-out code.

---

## Round 2 — non-blocking notes

1. **`packages/db/src/queries.ts:242` — `recentAlerts` still joins
   `workloads` without `AND w.org_id = a.org_id`.** Round 1 parked this as
   pre-existing. It is still the live one: this feature writes
   caller-supplied `e.workloadId` onto `alerts.workload_id`
   (`ingest.ts:339`, `:376`), and `/dashboard` plus `/budgets` render
   `recentAlerts`. Independent probe: org_other posting a redacted row
   that named `wl_secret` got `workloadName: "Project Redacted - M&A due
   diligence"` back from `recentAlerts`. Adding the org predicate (the
   same one now on `:463` and `:543`) would close it. Not blocking: the
   join predates this grain, round 1 told the builder it belongs in its
   own spec, and `unapproved_action` / `stale_pricing` already fed it.

2. **`packages/core/src/ingest/evidence.ts:254-270` — `detectSensitive` runs
   on metadata values, not on metadata keys.** A key that is itself an
   email and does *not* match the denylist is stored. Probe:
   `{ "victim.bob@example.com": "x" }` survived into
   `protocol_evidence.metadata`. The `_token` suffix is what made the
   round-1 example a *denied* key; without a denied word, the email is
   just another 64-character name. Same class of limit as `operation` /
   `actor` / `target`, which `EVIDENCE.md` already names. Applying the
   existing detectors to the key and dropping on a hit would close it.

3. **`packages/core/src/ingest/evidence.ts:166-192` — the widened denylist
   is fail-closed on a few honest names.** `errorMessage` (suffix
   `message`), `context` (suffix `text`) and `metadata` (suffix `data`)
   are dropped. Adapters do not emit them; `contentType` / `tokenCount` /
   `promptName` still survive, which is what the comment promised. A
   caller who loses `errorMessage` learns so from `evidenceRedacted`.
   Not a withhold: dropping a prose-shaped key is the direction this
   control is supposed to fail.

## Round 3 — 5/5

Independent rescore of `6894c75` / `effbd7c`, not a rubber stamp of round 2.
The change is one predicate on a pre-existing function, declared in
`EVIDENCE.md` § Deviations.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | Out-of-spec `recentAlerts` join is declared; it only narrows a read this feature made reachable. All ten criteria still hold. |
| 2 | Evidence proves it | ✅ | `after-findings.txt` now records both sides of the alert join; a fresh `findings.mjs` run matches it. `probe.mjs` is still byte-identical to `after.txt`, canaries included. |
| 3 | Structure holds | ✅ | One SQL predicate in `@ark/db`. No new dependency, no layer inversion. |
| 4 | Fails safely | ✅ | Note 1 is closed on the query and on the pages. Notes 2 and 3 are unchanged and remain non-blocking. |
| 5 | Readable | ✅ | Comment on `recentAlerts` says why the predicate is load-bearing now; `evidence.test.ts:345` covers both sides of the boundary. |

**Blocking:** none.
**Non-blocking:** round-2 notes 2 and 3 still stand (`detectSensitive` is not applied to metadata keys; the denylist is fail-closed on `errorMessage` / `context` / `metadata`).

**Note 1, re-measured.** Scratch DB, same reproduction as round 2: org_other posts evidence naming org_demo's `wl_secret` with a payload key so a `sensitive_data` alert is raised. `recentAlerts('org_other')` returns `workloadName: null`. `recentAlerts('org_demo')` still resolves `Project Redacted - M&A due diligence`.

Live Control, against `/workspace/ark.db` the server is reading: planted two `org_northwind` alerts, one naming `wl_support_triage` and one naming `wl_northwind_claims`, then fetched the pages.

- Northwind `/budgets` (200): both alert messages render; `Freight claims intake` appears in the Workload column; `Support ticket triage and refund handling` does not. (Northwind `/dashboard` is the empty state — no traces — so it does not render the alert list; that is pre-existing, not this change.)
- Demo `/dashboard`: `approval_missing · … · Support ticket triage and refund handling` and the same for `unapproved_action` / `loop_runaway`.
- Demo `/budgets` alert log: the Workload column next to those kinds is `Support ticket triage and refund handling`; `budget_breach` still names `Look up invoice totals for account queries`.

Planted rows were deleted after the fetch.

**Regressions.** `npm run typecheck` exit 0. `npm run test` 285/285 (the new join case is the +1). Four canaries in `before.txt` / `after.txt` unchanged.

The point holds. Notes 2 and 3 did not become blocking because an unrelated join was scoped.
