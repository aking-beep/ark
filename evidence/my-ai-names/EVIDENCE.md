# Evidence — my-ai-names

## What changed

A visitor to the consumer app now sees **MY AI** (wordmark, title, “Find MY AI”) instead of Fit. A visitor to the teams app now sees **MY AI for teams** instead of AIFit for teams. Control copy that named the estimator uses the new teams name.

## How it was measured

Same local processes: consumer `:3000`, business `:3001`. Viewport **1440×900**. Commands:

- `curl -sS GET http://127.0.0.1:3000/` and `GET http://127.0.0.1:3001/` (HTML dumps + string greps in `before.txt` / `after.txt`)
- Headless Chrome screenshots: `--window-size=1440,900 --virtual-time-budget=8000`

Stamps: `captures.tsv`. Before commit `38b224b` (parent of this branch). HTML/PNG before artefacts were taken from those live routes while they still served Fit / AIFit for teams (consumer 17:21Z, business 17:24Z). `factory-prove.sh before` was stamped later on a dirty tree — that warning is recorded; the dumps themselves still contain the old brand (see greps).

## Before / after

| | Before | After |
|---|---|---|
| Artefact | `before-consumer.html/.png`, `before-business.html/.png`, `before.txt` | `after-consumer.html/.png`, `after-business.html/.png`, `after.txt` |
| Consumer `/` title | `Fit — find the AI that fits you` | `MY AI — find the AI that fits you` |
| Consumer CTA | “Find my fit” | “Find MY AI” |
| Consumer wordmark | Fit. | MY AI. |
| Business `/` title | `AIFit for teams — should you build this?` | `MY AI for teams — should you build this?` |
| Business kicker | AIFit for teams | MY AI for teams |

`before.txt`: consumer `Fit —` True, `Find my fit` True, `MY AI` False; business `AIFit for teams` True, `MY AI for teams` False.

`after.txt`: consumer `MY AI —` True, `Find MY AI` True, `Find my fit` False; business `MY AI for teams` True, `AIFit for teams` False.

## What this does not prove

Headless Chrome, not a phone in someone’s hand. Control pages were not screenshotted; AC3 is proven by source strings and `deploy/runtime.test.mjs`. Historical ADRs, thesis, and architecture docs still say “AIFit” as the name of a past decision. Layout, engines, and the products staying unlinked did not change.

## Deviations

`factory-prove.sh before` ran after edits had started. The comparable before artefacts are the HTML dumps and 1440×900 PNGs taken from the live servers *before those files were saved*, not a reconstruction. No new dependency. Playwright specs that asserted “Find my fit” / “Fit score” now assert “Find MY AI” / “MY AI score”. `deploy/runtime.test.mjs` now also greps chrome files for the new names and the absence of `AIFit`. Control PRD current copy was updated to “MY AI for teams” so the operator-facing name matches AC3; ADRs were left historical.

## Definition of done

- **Cost / latency impact:** N/A — copy and titles only; no new network call, query, or model.
- **Observability for new failure modes:** N/A — no new failure mode; scoring and proxy paths unchanged.
- **Docs or ADR updated:** README product table and operator copy, `docs/prd/aifit-consumer.md`, `docs/prd/aifit-business.md`, `docs/prd/ark-control.md` current names, `docs/05-hosting.md` surface table, `docs/06-aifit-consumer.md` opening. No new ADR; architecture did not change.
