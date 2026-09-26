# Evidence — suite-competitive-loop

## What changed

A TypeScript caller can wrap the OpenAI or Anthropic client they already have,
run one unit of work, and see a trace in Control without reading the data model.
An empty Control org’s Spend page now points at Connect (`/start`) instead of an
operator note. The three products look like finished, **separate** products that
share a thesis — AI Fit names the files you walk away with; AI Fit Teams shows
Assess → Measure → Control; Control has a five-minute wrap snippet — and
`docs/08-how-ark-works.md` is the one-page map of what talks to what and what
never talks.

## How it was measured

Two artefacts, run identically before and after, plus screenshots at a fixed
viewport.

**A probe.** `node evidence/suite-competitive-loop/probe.mjs` imports `@ark/sdk`,
wraps a fake OpenAI `fetch`, hits the three landings, logs into Control as the
empty Northwind org, and checks that `docs/08-how-ark-works.md` exists. Same
command twice.

```bash
npm run build:packages
node evidence/suite-competitive-loop/probe.mjs | tee evidence/suite-competitive-loop/<phase>.txt
```

`before.txt` was captured on `720048a` (`factory-prove.sh` stamp `720048a`,
`dirty=1` because the evidence directory itself was being written). Feature code
had not landed.

**Screenshots, 1440×900, same routes.** `shots.mjs` captures consumer `/`, teams
`/`, Control `/dashboard` as Northwind (empty org), Control `/start` as Northwind,
and (after) Control `/start` as Demo Co (seeded org). Headed Chrome at
`/usr/local/bin/google-chrome`. HTML dumps of the three landings sit next to the
PNGs.

```bash
node evidence/suite-competitive-loop/shots.mjs after
```

Conditions: compiled packages, warm `next dev` on `:3000` / `:3001` / `:3002`,
seeded SQLite from `npm run setup`, fake LLM `fetch` for the wrap (no live
provider). Unauthenticated `/start` is 307 (`requireOrg`); the probe and the
shots log in first.

## Before / after

| | Before | After |
|---|---|---|
| Probe | `before.txt` | `after.txt` |
| Consumer `/` | `before-consumer.png` — files not named | `after-consumer.png` — `CLAUDE.md`, Cursor rules, `AGENTS.md` in the hero and how-it-works |
| Teams `/` | `before-teams.png` — essay, no loop | `after-teams.png` — heading `Assess → Measure → Control`, eight report sections |
| Control Spend (empty org) | `before-control-empty.png` — operator note | `after-control-empty.png` — primary CTA “Connect a workload” → `/start` |
| Control `/start` (empty org) | `before-control-start.png` — 404 / login bounce | `after-control-start.png` — three steps, wrap snippet, no bearer |
| Control `/start` (seeded org) | n/a (route did not exist) | `after-control-start-seeded.png` — same Connect page; Spend is still the home |

The probe lines that moved, before → after:

| Claim | Before | After |
|---|---|---|
| sdk exports `instrumentFetch` | ABSENT | yes |
| sdk exports `run` | ABSENT | yes |
| wrap: two turns one trace | ABSENT | yes (`tr_muict2z4_58ehzx5u` turns 0,1) |
| wrap: no prompt body in ingest | ABSENT | yes |
| wrap: Control URL is not a model call | ABSENT | yes |
| wrap: outside `run()` is a no-op | ABSENT | yes |
| consumer names `CLAUDE.md` | ABSENT | yes |
| consumer has For teams | no | no |
| teams shows Assess loop | ABSENT | yes |
| teams has Open AI Fit | no | no |
| GET `:3002/start` | 404 | 200 |
| `/start` names `instrumentFetch` | ABSENT | yes |
| `/start` prints a bearer secret | no | no |
| `docs/08-how-ark-works.md` | ABSENT | yes |

Unchanged on purpose: consumer still has no “For teams”; teams still has no
“Open AI Fit”; `/start` still never interpolates a bearer.

## What this does not prove

- Live OpenAI or Anthropic. The wrap probe uses a fake `fetch`. Schema drift at
  the provider fails open in code; that path is unit-tested, not live-tested.
- A real Control ingest of a wrapped client in this evidence pack. The probe
  asserts the POST body shape against a stub; it does not round-trip through
  `:3002` `/api/v1/events`.
- Small viewports. Screenshots are 1440×900 only.
- That the three visual systems feel like one design language. Out of scope:
  consumer stays cream/Geist; teams and Control stay the dark instrument panel.
- Python SDK, SSO, billing, Postgres, hosted SaaS.
- Funnel absence beyond string checks on the two landings and the chrome.
- Concurrent wrap under load. Isolation is a unit test, not a soak.
- Seeded-org `/start` before-state. The route 404’d for every org; only the
  empty-org bounce was captured before.

## Deviations

- Spec AC1 said `run` closes the trace as `success` or `error`. The ingest
  schema’s outcome enum is `success | failure | escalated | abandoned | pending`
  (`packages/core/src/ingest/schema.ts`). `run()` closes as `'failure'` on
  throw. Same behaviour, the word the schema already uses.
- Connect layout is step 1 full-width, then steps 2 and 3 side by side, not a
  three-column row. The spec required that order of paths, not a three-column
  grid; a 1440px three-column row clipped the wrap snippet so it was not
  copy-pasteable.
- No new third-party npm dependency.
- Owner correction (2026-09-26): user-facing names are **AI Fit**, **AI Fit
  Teams**, and **Control**. Engine paths stay `my-ai/` / package `myai`. The
  spec’s original “Find MY AI” / “MY AI for teams” strings were updated in the
  same spec to match. Historical evidence directories are unchanged.

## Definition of done

- **Cost / latency impact:** Wrap clones the LLM response and parses token
  counts inside `run()`. That is one extra `Response.clone()` + JSON parse per
  instrumented call, plus a best-effort ingest POST bounded by `timeoutMs`. No
  new model call is introduced. AI/cloud cost of the feature itself is not
  applicable: it observes calls the user already makes.
- **Observability for new failure modes:** Parse failures fail open (the user
  `fetch` still returns; ARK records nothing). Ingest failure inside `run()` is
  `.catch`’d so Control down does not fail `fn`. The empty Spend CTA is the
  operator path when there is nothing to see. No new metric was added; ingest
  already returns 202 with counts.
- **Docs or ADR updated:** `docs/08-how-ark-works.md` (new map). README “How it
  fits together”, `docs/01-architecture.md` top link, teams `/methodology`,
  Control `/start`, consumer `/methodology` (separate product, no teams URL).
- **Rollback:** revert the branch. Explicit `trace.event()` remains the
  supported path; wrap is additive.
- **Authorization / privacy:** wrap never stores request or response bodies as
  samples. `/start` names `ARK_CONTROL_TOKEN`, never interpolates one.
  `requireOrg()` still gates the page. Org isolation unchanged.
- **AI behaviour evals:** not applicable — no new model is called; wrap parses
  provider JSON and fails open.
- **Staging / production release:** this pack is local `next dev` + seeded
  SQLite. Production release still needs human approval (`GOVERNANCE.md`).
