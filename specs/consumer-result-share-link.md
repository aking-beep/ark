# consumer-result-share-link

**Status:** DRAFT — a station may not be built in until this reads APPROVED.
**Approved by:**
**Date:**

## Problem

Someone finishes the six-question consumer assessment and gets a verdict they want to keep or send to a colleague. The answers already live in the `/result?i=` URL and nothing is stored, but the result page itself has no share or copy control. The only hint is a site-wide footer in small grey type. Today they copy from the address bar (if they notice), screenshot the page, or give up.

## Outcome

On a valid consumer result, a person can copy the current result URL in one click and is told, next to that action, that the link itself holds their answers.

## Acceptance criteria

Each one testable, each one a thing a reviewer can check off.

1. A valid result page (`/result?i=` with a decodeable intake) shows a copy control that writes the current page URL to the clipboard.
2. After a successful copy, the control confirms it (for example the label becomes "Copied") and the page does not navigate away.
3. Next to the copy control — not only in the site footer — the page states that the link contains the answers and that nothing is stored. A person who thinks the link is opaque must not be able to copy it without seeing that.
4. The broken-link recovery panel (missing, truncated, or invalid `i`) does not show the copy control.
5. No persistence, no short URL, no third-party share widget, no new npm dependency.

## How this will be proved

Station port is **3001** (`worktrees/consumer-result-share-link/.factory-station`). Consumer app in this station must bind that port.

- **Artefact:** screenshots, same viewport and same URL, plus a test that the copy control calls the clipboard with `window.location.href`.
- **Measured by:**
  - Before: screenshot of a valid `/result?i=…` page at **390×844**. The page has a verdict and no copy control.
  - After: the same URL at **390×844**. A copy control and the "link contains your answers" disclosure are visible without scrolling past the verdict heading.
  - After, second shot: `/result` with no `i` (or a garbage `i`) at **390×844**, showing the recovery panel and no copy control.
  - A test living next to the new client control, asserting it writes the current href on click and then shows confirmation.
- **Conditions:** worktree `worktrees/consumer-result-share-link`, `next dev` on port 3001, cold load, no Control calibration required (heuristic figures are fine). Use one encoded intake for both valid-result shots so the verdict text is identical.

## Out of scope

- The business report page (`apps/business` `/report`) has the same gap; that is a separate feature.
- Native share sheets (Web Share API), mailto, QR codes, social buttons.
- Encrypting or shortening the payload; the codec and `i` parameter stay as they are.
- Changing the site-wide footer copy.
- Analytics on copy clicks.

## Risk

Clipboard write is a browser API on a client component; it is not persistence and it does not leave the user's machine. The URL still contains the intake in clear encoding (ADR-0003). The disclosure next to the copy control is the mitigation. No auth, no payments, no migrations, no model calls, no new dependency. Security review is not required beyond the rubric's privacy read of the disclosure.

- **Rollback:** revert the result-page copy control. The URL already worked; this only adds a way to copy it.
