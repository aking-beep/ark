# Evidence — my-ai-names

## What changed

A visitor to the consumer app now sees **MY AI** (wordmark, title, “Find MY AI”) instead of Fit. A visitor to the teams app now sees **MY AI for teams** instead of AIFit for teams. Control copy that named the estimator uses the new teams name. An operator installing the consumer engine now uses `my-ai/`, Python package `myai`, and `npm run dev:my-ai-api` — not Fit.

## How it was measured

Same local processes: consumer `:3000`, business `:3001`, MY AI API `:8472`. Viewport **1440×900**. Commands:

- `curl -sS GET http://127.0.0.1:3000/` and `GET http://127.0.0.1:3001/` (HTML dumps + string greps in `before.txt` / `after.txt`)
- Headless Chrome screenshots: `--window-size=1440,900 --virtual-time-budget=8000`
- Engine after: `after-engine.txt` (`python3 -c import myai`, `/health` JSON `product: MY AI`, `fit/` absent, `my-ai/` present, npm scripts)

Stamps: `captures.tsv`. Before commit `38b224b` (parent of this branch). HTML/PNG before artefacts were taken from those live routes while they still served Fit / AIFit for teams (consumer 17:21Z, business 17:24Z). `factory-prove.sh before` was stamped later on a dirty tree — that warning is recorded; the dumps themselves still contain the old brand (see greps).

Owner follow-up after Round 1: also rename the engine so the names make sense across the board. Spec AC6 was added; `fit/` became `my-ai/`, package `aifit` became `myai`.

## Before / after

| | Before | After |
|---|---|---|
| Artefact | `before-consumer.html/.png`, `before-business.html/.png`, `before.txt` | `after-consumer.html/.png`, `after-business.html/.png`, `after.txt`, `after-engine.txt` |
| Consumer `/` title | `Fit — find the AI that fits you` | `MY AI — find the AI that fits you` |
| Consumer CTA | “Find my fit” | “Find MY AI” |
| Consumer wordmark | Fit. | MY AI. |
| Business `/` title | `AIFit for teams — should you build this?` | `MY AI for teams — should you build this?` |
| Business kicker | AIFit for teams | MY AI for teams |
| Engine directory | `fit/` | `my-ai/` |
| Python package | `aifit` | `myai` |
| npm scripts | `dev:fit-api` / `test:fit` | `dev:my-ai-api` / `test:my-ai` |
| `/health` product | Fit (prior) | `"product":"MY AI"` |
| Proxy errors | “Fit API is not configured” | “MY AI API is not configured” |

`before.txt`: consumer `Fit —` True, `Find my fit` True, `MY AI` False; business `AIFit for teams` True, `MY AI for teams` False.

`after.txt`: consumer `MY AI —` True, `Find MY AI` True, `Find my fit` False; business `MY AI for teams` True, `AIFit for teams` False.

## What this does not prove

Headless Chrome, not a phone in someone’s hand. Control pages were not screenshotted; AC3 is proven by source strings and `deploy/runtime.test.mjs`. Historical ADRs, thesis, and past evidence directories still say “AIFit” / `fit/` as the name of a past decision. Layout and scoring did not change. HTTP `/v1/*` paths are unchanged. Docker image was not rebuilt here (no daemon).

## Deviations

`factory-prove.sh before` ran after edits had started. The comparable before artefacts are the HTML dumps and 1440×900 PNGs taken from the live servers *before those files were saved*, not a reconstruction. No new dependency. Playwright specs that asserted “Find my fit” / “Fit score” now assert “Find MY AI” / “MY AI score”. `deploy/runtime.test.mjs` greps chrome files for the new names, the absence of `AIFit`, and the `my-ai/` engine paths. Control PRD current copy was updated to “MY AI for teams”. Spec AC6 was added after owner follow-up (engine rename); Round 1 reviewed the chrome-only spec.

Internal type names (`FitFilters`, `UserFitVector`, `myai.fit`) stay as matching-domain vocabulary, not the product name.

## Definition of done

- **Cost / latency impact:** N/A — copy, titles, and path/package rename only; no new network call, query, or model.
- **Observability for new failure modes:** Proxy still returns JSON 502/504; messages now say MY AI API. Timeouts unchanged (20s).
- **Docs or ADR updated:** README, hosting, consumer docs, PRDs, `.env.example`, CI. No new ADR; architecture of scoring did not change.
