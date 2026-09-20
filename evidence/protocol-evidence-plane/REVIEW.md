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
