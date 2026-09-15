# Evidence — consumer-fit-look

## What changed

Consumer AIFit now looks like the live Fit site: cream page, terracotta actions, Fit. wordmark, Simple/Detailed and light/dark in the header, a landing with pills and numbered how-it-works cards, and an intro before the six questions. The engine, the questions, and the URL-encoded result did not change.

## How it was measured

Same machine, consumer on port 3000, viewport **1440×900** unless noted, same encoded intake as `evidence/documented-product-complete/intake.txt`. Headless Chrome (`google-chrome --headless=new --window-size=… --screenshot=… --virtual-time-budget=8000`) plus `curl -sS` HTML dumps of the same routes.

- Before: `GET /`, `GET /assess`, `GET /result?i=<intake>`, `GET /result?i=garbage`
- After: the same four routes, plus `GET /example` (follows redirect) and `/` at **390×844**
- `git diff origin/main -- packages/ui/tailwind-preset.cjs` (must be empty)
- `npm run test --workspace @ark/consumer` (copyHref, reading-level parse, example intake shape)
- Playwright click-through against the same port (`after-walk.txt`): landing → how-it-works → privacy → Find my fit → Let’s go → six questions → result; See an example; garbage `i`; theme toggle; mobile menu. Body background measured `oklch(0.985 0.018 85)` light and `oklch(0.19 0.017 55)` dark.

Capture timestamps and commit SHAs are in `captures.tsv`, written by `scripts/factory-prove.sh`.

## Before / after

| | Before | After |
|---|---|---|
| Artefact | `before-home.png` (plus `before-*.html`) | `after-home.png` (plus `after-*.html`) |
| `/` header | Dark ink, “AIFit by ARK”, Start over | Cream, Fit. with coral period, Simple/Detailed, theme toggle, Try it / How it works / Privacy |
| `/` background | Dark `bg-ink-*` (8× `bg-ink-850` in HTML) | Cream Fit tokens; title `Fit — should you use AI for this?` |
| `/` CTA | “Check one task” only | “Find my fit” + “See an example”; audience pills; 3 how-it-works cards |
| `/assess` | Wizard step 1 immediately | Intro “Let’s go”, then the same six questions |
| `/result?i=<intake>` | Dark panels, Copy link present, weekly-email assisted verdict | Same verdict and Copy link on cream cards; no cost / no model |
| `/result?i=garbage` | Recovery, no Copy link | Recovery on cream, no Copy link |
| `/example` | (did not exist) | Redirects to a `not-ai` result (“Don’t use AI for this”) |
| Shared preset | — | `packages/ui/tailwind-preset.cjs` diff vs main: 0 bytes |

## What this does not prove

Screenshots and the click-through (`after-walk.txt`) used headless Chrome, not a phone in someone’s hand. Copy-link was clicked in that walk; the button label did not change to “Copied” because the headless clipboard is unavailable — the unit test of `copyHref` is what proves the write. Simple/Detailed helper-text on later wizard steps was not asserted beyond `aria-pressed` on the toggle. Business and Control were not restyled; they were confirmed only by an unchanged preset file and by the running business app still identifying as AIFit, not by a full visual pass. The live Fit twelve-scene quiz and setup-file product are intentionally not reproduced.

## Deviations

None. No new runtime npm dependency (inline SVGs instead of lucide). Storage keys are `aifit.readingLevel` and `aifit.theme` rather than Fit’s `fit.*` so the two sites do not clobber each other if opened on the same origin later.

## Definition of done

- **Cost / latency impact:** N/A — CSS, fonts from `next/font`, and localStorage. No new model call, no new query, no `@ark/db`.
- **Observability for new failure modes:** N/A — no new server path except `/example` (a redirect) and two static pages. Clipboard failure still surfaces the existing “copy the address bar” message.
- **Docs or ADR updated:** N/A — visual restyle of one app; the six-question contract and ADR-0003 (result in the URL) are unchanged.
