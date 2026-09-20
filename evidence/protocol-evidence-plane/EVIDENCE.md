# Evidence — protocol-evidence-plane

## What changed

ARK Control can now see what an agent *did* — which MCP tool it called, which
peer agent it delegated to, which human approved the payment — and not just what
it spent. Six agent protocols (MCP, A2A, AG-UI, A2UI, UCP, AP2) are normalised
into one evidence grain on the trace that already carries the model cost, and an
operation that required a human signature and completed without one now raises
an alert instead of passing silently.

## How it was measured

Three artefacts, all repeatable from a clean checkout.

**A probe, run identically before and after.** `evidence/protocol-evidence-plane/probe.mjs`
pushes the DDL into a scratch libSQL file, posts bodies through the real
`applyIngest`, and prints one line per claim. It exercises the schema, the
adapters, the redaction, the alert conditions, the tenancy boundary and the SDK.
Crucially it also re-measures four *pre-existing* behaviours (unpriced model
events, `loop_runaway`, `unapproved_action`, prompt-sample scanning) so a
regression in the old grain shows up as a changed line.

```bash
npm run build:packages
node evidence/protocol-evidence-plane/probe.mjs > evidence/protocol-evidence-plane/<phase>.txt
```

`before.txt` was captured on `646fe6f`, before the first line of feature code.

**Screenshots, same viewport, same routes, same org, same code path.**
`shots.mjs` logs in as the seeded demo org (`dana@riverbend.example`) at
1440×900 and captures `/protocols`, `/dashboard`, `/workloads/wl_support_triage`
and `/budgets` full-page. `pages.mjs` then walks every Control route twice —
once as the seeded org, once as Northwind, which has zero protocol evidence —
and records the HTTP status and any uncaught page error.

```bash
npm run setup                      # push schema, seed
npm run dev -w @ark/control        # localhost:3002
node evidence/protocol-evidence-plane/shots.mjs after
node evidence/protocol-evidence-plane/pages.mjs > evidence/protocol-evidence-plane/after-pages.txt
```

**A second probe for the round-1 review findings.** `findings.mjs` feeds the
reviewer's own inputs to the fixed code and prints what it does now. It is a
separate script on purpose: `probe.mjs` is valuable precisely because the same
assertions ran before the first line of feature code, and adding assertions to
it now would produce an after-state with no before-state. The before-state for
these lines is `REVIEW.md`, which records each input and what the code did with
it.

```bash
node evidence/protocol-evidence-plane/findings.mjs > evidence/protocol-evidence-plane/after-findings.txt
```

Conditions: seeded demo data (`npm run setup`), warm dev server, headless
Chrome, one machine. The seed is deterministic in shape but jittered in time, so
counts are stable and the "Xm ago" column is not.

## Before / after

| | Before | After |
|---|---|---|
| Probe | `before.txt` | `after.txt` |
| `/protocols` | `before-protocols.png` — 404 | `after-protocols.png` — 321 observations, six cards |
| `/protocols`, org with no evidence | n/a (route did not exist) | `after-protocols-empty.png` — empty state, not a 500 |
| Workload detail | `before-workload.png` | `after-workload.png` — cross-grain trace story added |
| Spend / Budgets | `before-dashboard.png`, `before-budgets.png` | `after-dashboard.png`, `after-budgets.png` — unchanged |
| Route sweep | — | `after-pages.txt` |

The probe lines that moved, before → after:

| Claim | Before | After |
|---|---|---|
| `@ark/protocols` resolves | ABSENT | yes |
| tables in pushed schema | 14 | 15 |
| evidence-only body parses | no | yes |
| duplicate evidence id is a no-op | ABSENT | yes (1 row after 2 posts) |
| MCP adapter leaks raw args/results | ABSENT | no |
| A2UI adapter leaks application data | ABSENT | no |
| nested metadata rejected at schema | ABSENT | yes |
| `redactEvidence` strips payload metadata | ABSENT | yes (`arguments`, `note`) |
| `approval_missing` fires on completed | ABSENT | yes (critical) |
| `approval_missing` silent while pending | ABSENT | yes |
| evidence rows per org | ABSENT | `org_demo=3 org_other=1` |
| `trace.evidence()` correlation | no `trace.evidence()` | `tr_sdk/wl_probe` |

The four regression lines are byte-identical across the two files: unpriced model
events `1/1`, `loop_runaway` `true`, `unapproved_action` `1/1`, prompt sample
`["email"] / no sample column=true`. `diff before.txt after.txt` shows no other
changes.

Seeded demo data behind `after-protocols.png`: 321 observations across 120
traces — MCP 157, A2A 49, AG-UI 46, A2UI 26, AP2 22, UCP 21 — and exactly one
`approval_missing` alert, at critical, from the deliberately unapproved AP2
mandate. The 12,315 existing model events are untouched; no protocol observation
was written to the `events` table.

Repo checks, run at the tip of the branch:

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run test` | 285 tests, 285 pass, 0 fail (161 before this branch; +124 new) |
| `npm run build` | exit 0, `/protocols` in the route manifest |
| `npm ci && npm run setup` | exit 0 from a clean lockfile install |

### Round 1 findings, closed

The reviewer withheld criterion 4 on two findings and raised six non-blocking
notes. All of round 1 is addressed; `after-findings.txt` is the measurement.

| Finding | Before (from `REVIEW.md`) | After |
|---|---|---|
| 1 — the redaction alert persisted caller key names | posting `{"victim.bob@example.com_token": "x"}` wrote that key, and so that email address, into `alerts.message` | the alert names the class (`a field named as a payload or a credential`); the key appears nowhere in `alerts`, and `detectSensitive` finds nothing in the message |
| 2 — `recentEvidence` and `traceStory` joined `workloads` unscoped | an org naming another tenant's workload id read back `Project Redacted - M&A due diligence` | `workloadName` resolves to null across the boundary and still resolves for the org's own rows |
| 3 — the denylist missed payload words that were not at the end of a key | 16 of 16 names survived (`argsJson`, `promptText`, `resultData`, …) | 0 of 16 survive; all 19 metadata keys the adapters emit still do |
| 4 — the redaction alert named the wrong workload | attributed to the first row in the batch carrying any workload | attributed to the row that carried the field (`wl_dirty`), and the clean row raises nothing |
| 5 — `evidence()` let a caller override the trace id, `event()` did not | an adapter result carrying a stale `traceId` re-pointed the observation | the handle's trace id wins, as in `event()`; the workload may still be overridden |
| 6 — A2UI stored whatever it was handed as a component name | a form value passed as a component type was stored | non-identifier entries are rejected and counted in `componentsRejected`; `Card,MyOrgChart` is kept and the form values are not |
| 8 — one value query per protocol | 4 + one per protocol | one `GROUP BY protocol`; five queries behind the page |

Note 7 — the evidence loop is not transactional — is left as it is. It is the
pre-existing pattern for events, actions and quality samples, the idempotent
primary key means a re-posted batch converges, and changing it for one grain
would make the four inconsistent. It belongs in its own spec.

### One more, found in round 2

`recentAlerts` (`queries.ts:242`) had the same unscoped join, and round 1 parked
it as pre-existing and out of scope. Round 2 showed it is not out of scope any
more: until this feature existed, an alert's `workload_id` came from a workload
ARK had already matched, and the two evidence alerts are the first to carry the
`workloadId` the *sender* supplied. Round 2 confirmed the disclosure by posting
as one org and reading `Project Redacted - M&A due diligence` off its own
`/dashboard`. This diff opened it, so this diff closes it: `AND w.org_id =
a.org_id`, measured in `after-findings.txt`, with the org's own alerts still
naming their workload.

`probe.mjs` was re-run unchanged after the fixes and its output is byte-identical
to the capture taken before them, so none of this moved the original claims.

The rest of the platform, started by `npm run dev` and recorded in
`after-platform.txt`: MY AI (consumer, 3000) 200, MY AI for teams (business,
3001) 200, ARK Control (3002) 200, MY AI API (python, 8472) 200, and the python
suite 23 passed. `apps/` still holds three apps; `@ark/runtime` is still a
package.

Capture timestamps and commit SHAs are in `captures.tsv`, written by
`scripts/factory-prove.sh`.

## What this does not prove

**No protocol was spoken.** Every observation in this evidence was produced by
an adapter from a hand-written or seeded input. Nothing here connected to a real
MCP server, a real A2A peer, a real merchant or a real payment network, and the
adapters were written against published specifications rather than against
traffic. The first real client will find fields these adapters name differently.

**Redaction is proved against the payloads we thought to try.** The probes and
the tests show that the denylist, the scalar-only metadata schema and the
adapters' allowlists stop raw arguments, message bodies, application data and
signatures, and the round-1 review found sixteen key names the denylist missed,
which are now caught. That is the point: a denylist catches the names it knows,
and the next reviewer will find more. It is the weakest of the three layers and
the adapters' allowlist is the one that actually holds. Nor does any of this
stop a caller putting an email address in `operation`, `actor` or `target` —
those are free strings by design.

**One browser, one viewport, one machine.** Headless Chrome at 1440×900, local
dev server, SQLite file. Nothing was tested at another width, in another
browser, against Postgres, or under load. The `/protocols` page issues six
queries per render against 321 rows; at a million rows that is an unmeasured
question.

**Seeded shapes, not production shapes.** 321 observations with a hand-designed
distribution, including one hero trace built to cross all six protocols. Real
traffic will be lopsided in ways this data is not, and the per-protocol cards
have not been seen with a protocol that has ten thousand times the volume of its
neighbour.

**The value de-duplication is a judgement, not a measurement.** A UCP checkout,
its AP2 mandate and its AP2 receipt are three true observations of one amount,
so the headline takes the largest amount per trace. That is right for the demo
data. It is an assumption about how protocols co-occur, and a trace that
legitimately contains two different payments will under-count.

## Deviations

**No new dependency.** `@ark/protocols` depends on `@ark/core` and nothing else;
no protocol SDK was added. The specs were read, the adapters were written to
them, and the version each was built against is recorded in
`PROTOCOL_SPEC_VERSIONS` and displayed on each card. Pulling in six vendor SDKs
to normalise six shapes into one row would have added six upgrade treadmills for
no behaviour.

**One test was changed, and it was wrong.** `packages/db/src/evidence.test.ts`
asserted `assert.match(message, /toolArguments/, 'the alert names the key')` —
it locked in the behaviour of round-1 finding 1, requiring the alert to quote
the caller's key name. It is replaced by a block asserting the opposite: the
alert names the class, and no key reaches the alerts table. Three tests that
used `note` as an example of an innocent key now use `stepName`, because `note`
is a denied key after the finding-3 fix and those tests were meant to exercise
the *value* detector rather than the denylist. No other test was changed, and
none was removed: `git diff main...HEAD --numstat -- '*.test.ts'` shows the
remaining files are additions only. The 123 new cases are additive.

**Two things were fixed that the spec did not ask for**, both inside the feature's
own surface and both visible in the screenshots. `fmt.when` clamped at zero, so
a timestamp a few seconds in the future reads `0m ago` rather than `-1324m ago`;
and the seed now draws only from traces that have already started, because
`started_at` is jittered across its day and today's traces sit in the future. The
first is a one-line change in a shared primitive and does affect other pages —
it can only make a negative duration render as zero, which no page wants.

**One pre-existing function was changed:** `recentAlerts`, which `/dashboard`
and `/budgets` both read. The spec did not ask for it and round 1 ruled the
unscoped join out of scope as pre-existing. Round 2 showed this diff is what
makes it reachable — the evidence alerts are the first to carry a caller-supplied
`workloadId` — so leaving it would have meant shipping a cross-tenant
disclosure that this feature opened. The change is one predicate on a join and
cannot widen what a page returns, only narrow it to the org already being
queried.

**The route sweep expects a 404.** `pages.mjs` asserts that Northwind gets 404 on
the demo org's workload URL. That 404 is the tenancy boundary, not a broken page,
and the script says so rather than silently allowing any status.

## Definition of done

- **Cost / latency impact:** One new table and four indexes; nothing is written
  unless a caller sends `evidence[]`, so an existing installation that does not
  use the adapters pays one extra empty-array check per ingest. The `/protocols`
  page adds six queries, all covered by the new indexes, against 321 seeded
  rows — a count that does not grow with the number of protocols. No provider
  calls, no network, no background job: the adapters are pure functions. Not
  measured at production row counts — see above.
- **Observability for new failure modes:** The two failure modes this introduces
  are a payload reaching the database and an operation completing without its
  approval. The first raises a `sensitive_data` alert, per observation, when
  ingest has to redact something the SDK should already have stripped, so a
  mis-integrated client is visible rather than silent — and the alert reports
  the class of thing dropped, from a fixed vocabulary, rather than the caller's
  field names, because a field name can itself be the sensitive value. The
  names go back to the sender in the ingest response, which is not stored.
  The second is the `approval_missing` alert, whose
  severity follows the recorded risk, surfaced on the Protocols page and in
  Budgets & alerts. A blocked or denied operation is recorded as evidence with
  that outcome and counted on the page.
- **Docs or ADR updated:** `docs/07-protocol-evidence.md` (new — the grain, the
  canonical schema, the three redaction layers, each adapter's mapping,
  developer usage), `docs/adr/0007-protocols-are-adapters-not-surfaces.md` (new
  — why this is six adapters and not six products), and
  `README.md`, `docs/01-architecture.md`, `docs/03-data-model.md` updated for the
  fourth grain, the new package and the new table.
