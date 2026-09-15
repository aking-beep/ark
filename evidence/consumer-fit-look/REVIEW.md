## Round 1 — 2026-09-15 — 5/5

From the artifacts alone, a visitor to consumer AIFit now gets a cream Fit surface (Fit. wordmark, Simple/Detailed, theme toggle, “Find my fit” / “See an example”, numbered how-it-works cards) instead of the dark “AIFit by ARK” instrument panel, an intro on `/assess` before the six questions, and the same URL-encoded verdicts on cream cards — including a deterministic “Don’t use AI for this” example and a garbage-`i` recovery with no copy control.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All six acceptance criteria met. Cream/terracotta `/` with Fit. wordmark, Simple/Detailed, theme toggle, and Try it / How it works / Privacy (`after-home.png`). Landing structure matches AC2. `/assess` intro then the same six questions (`after-assess.png`, `after-walk.txt`). `/example` is a `not-ai` result. Shared preset untouched. No new runtime npm dependency. |
| 2 | Evidence proves it | ✅ | Before at `d844ad7` dirty=0, after at `4e3c26f` (dirty files are the after artefacts). Same machine, 1440×900, same four routes plus after `/example` and 390×844 `/`. Honest “does not prove” line. |
| 3 | Structure holds | ✅ | Change stays in `apps/consumer` edge/UI. No DB or provider client. `ink`/`signal` remapped in the consumer Tailwind config so `@ark/ui` primitives are not rewritten. Spec did not authorize a new dependency; none was added. |
| 4 | Fails safely | ✅ | Garbage `i` still recovers with no copy control. Clipboard failure still tells the user to copy the address bar (`copy-result-link.tsx:34`). `localStorage` failures in theme and reading-level are caught and the in-session choice still applies. Theme init script is wrapped in try/catch. No new network or model call. |
| 5 | Readable | ✅ | Restyle is confined to the consumer app. Comments explain why tokens are remapped locally, why the theme script runs before paint, and why the example intake is calculate/lookup. Tests cover `parseReadingLevel` and the example intake shape. |

**Blocking:** none.
**Non-blocking:** `evidence/consumer-fit-look/after.txt:9` greps “Let's go” as empty because the HTML dump encodes the button as `Let&#x27;s go`; the screenshot and walk still show the intro. `apps/consumer/src/components/site-header.tsx:98` exports `SiteFooter` from the header module. Simple vs Detailed helper shortening (`apps/consumer/src/components/wizard.tsx:81`) is implemented but the walk only asserted `aria-pressed` on the toggle, as `EVIDENCE.md` already says.
