# consumer-fit-look

**Status:** APPROVED
**Approved by:** repository owner (restyle consumer AIFit to match the live Fit surface)
**Date:** 2026-09-15

## Problem

The live Fit site at https://aifit-engine.vercel.app/ is cream, terracotta, Geist, and a landing that reads as a product for everyday people. Consumer AIFit (`apps/consumer`) is the same job in this repo — six questions, a straight answer including no — but it still wears the dark ink/teal instrument-panel look shared with Control. A person who knows Fit and then opens this app does not recognise it.

## Outcome

Consumer AIFit looks like Fit: cream page, terracotta actions, Fit. wordmark, Simple/Detailed and light/dark chrome, a landing with kicker / pills / numbered how-it-works cards, and an assessment intro before the six questions. The engine, the six questions, the URL-encoded result, and the ability to say no do not change. Business and Control stay on the shared dark preset.

## Acceptance criteria

Each one testable, each one a thing a reviewer can check off.

1. `/` on the consumer app (port 3000) is a cream page (`#fffaee` / equivalent CSS variable) with terracotta primary (`#cb4a2a` / equivalent). The header wordmark is `Fit` with a coral period. Simple / Detailed and a theme toggle are in the header. Nav includes Try it, How it works, and Privacy. The shared Tailwind preset in `packages/ui/tailwind-preset.cjs` is not modified, so business and Control keep their dark ink/teal chrome.
2. The landing follows Fit’s structure: uppercase terracotta kicker, large headline, short supporting copy, audience pills, a filled primary CTA and an outline secondary CTA, a “How it works” row of three numbered cards, and a second row of three value cards. Warm gradient blobs sit behind the hero. Copy describes the ARK job (six questions, a verdict including no, nothing stored) rather than Fit’s twelve-scene personality quiz or setup files.
3. `/assess` opens on an intro (“Let’s go”) then the existing six-question wizard. Question text, options, and `fromConsumerIntake` mapping are unchanged. The secondary landing CTA “See an example” lands on a valid `/result?i=` for a deterministic `calculate`/`lookup` task so the `not-ai` verdict is visible without a demo API or session store.
4. Simple / Detailed persists in `localStorage`. Simple shortens question helper copy; Detailed shows the full helpers. The theme toggle persists and applies a `.dark` class from an inline init script so the first paint matches the saved choice. No account, no email, no `@ark/db`.
5. A valid `/result?i=` still shows the verdict, recommended pattern, unlocks when not-yet, basis tags, and the copy-link control with the “link contains your answers” disclosure. A missing or garbage `i` still shows the recovery panel and no copy control. Those surfaces use the same cream/terracotta language as the landing (consumer colour remap of `ink` / `signal`, not a rewrite of `@ark/ui` primitives). No cost figure, no model recommendation, no calibration fetch.
6. No new runtime npm dependency. Inline SVGs instead of an icon package. Privacy and How it works are first-party pages with ARK facts (nothing stored; answers live in the URL), not Fit’s session-delete product.

## How this will be proved

Cloud station is this container (see `factory/05-CLOUD.md`). Consumer binds port 3000.

- **Artefact:** screenshots at **1440×900**, same routes before and after, plus HTML captures of those routes. Mobile **390×844** after-shot of `/` to show the header chrome collapses.
- **Measured by:**
  - Before: `GET /`, `GET /assess`, `GET /result?i=<same intake as documented-product-complete>`, `GET /result?i=garbage` — dark ink header “AIFit by ARK”, no Simple/Detailed, no cream background.
  - After: the same four routes. Landing HTML contains `Fit` + coral period, “Let’s go” or “Find my fit”, Simple/Detailed. Computed `background-color` of `body` is cream in light theme. Garbage result still has no “Copy link”. Shared preset file is unchanged (`git diff main -- packages/ui/tailwind-preset.cjs` empty).
- **Conditions:** `npm run dev:consumer` on port 3000, cold load, no Control. One encoded intake reused for valid-result shots.

## Out of scope

- Restyling `apps/business` or `apps/control`.
- Fit’s twelve-scene quiz, setup-file product, demo session API, or registry of models.
- Changing the six questions, the verdict ladder, or the URL codec.
- Hosting the restyle on Vercel.

## Risk

Theme and reading-level keys live only in the browser (`localStorage`). They are not answers and are not sent anywhere. The result URL still contains the intake in clear encoding (ADR-0003); the copy-link disclosure is unchanged. No new third-party runtime dependency. No auth, payments, or model calls.

- **Rollback:** revert the branch. Business and Control are untouched. Old `/result?i=` links still decode.
