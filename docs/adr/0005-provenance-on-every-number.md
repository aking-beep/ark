# ADR-0005: Provenance on every number, not a disclaimer at the bottom

**Status:** Accepted
**Date:** 2026-09-14

## Context

Every tool in this category handles uncertainty the same way: a paragraph at the bottom of the report saying estimates are approximate and actual results may vary.

That paragraph does nothing. It is read once, absolves everything above it, and — critically — it is identical whether the figure above it came from a published price list or from a guess somebody made in a meeting. The user has no way to tell which numbers to trust, so they trust all of them equally, which means they trust the worst one as much as the best one.

Meanwhile the figures that are genuinely solid — list prices, context windows — get tarred by the same disclaimer as the ones that are invented.

## Decision

Four rungs, rendered inline next to every user-facing number by one component.

| Basis | Meaning |
|---|---|
| `heuristic` | A rule of thumb from the rubric. Defensible, arguable, not observed. |
| `benchmark` | A published figure — list price, stated context window, third-party benchmark. |
| `calibrated` | Derived from measurements on systems like yours, not yours. |
| `measured` | Computed from your own telemetry, above the 30-trace sample floor. |

Three rules make it real rather than decorative:

**One component.** `BasisTag` lives in `packages/ui` and is the only way a basis is rendered. Centralising it means the ladder looks identical on every surface and cannot be quietly dropped from one page during a redesign.

**The weakest link governs the whole.** `weakestBasis()` walks every estimate feeding a derived figure and returns the lowest rung found. A `measured` cost multiplied by a `heuristic` displacement assumption yields a `heuristic` ROI. Reporting otherwise would be laundering a guess through a measurement.

**A sample floor of 30.** Below it, `resolveCallShape` returns the rubric prior and reports the observed count in its source string — so the report says "only 11 observations for bounded-agent, below the 30 needed to trust them" rather than silently using them or silently ignoring them. A mean drawn from four traces is noise wearing a decimal point.

## Consequences

**Good.**

- The user can locate the assumption they disagree with. That is the difference between a report that survives scrutiny and one that survives only inattention.
- It makes Control's value legible without a sales argument. The same report reads `heuristic` before Control is running and `measured` with a sample size after. Nobody has to be told what the telemetry is for.
- It forces honesty in the engine. A figure cannot be rendered without a basis, so an invented number has nowhere to hide — there is no valid tag for it.
- It survives redesign. The constraint is in the type system, not in a style guide.

**Bad.**

- **Most numbers are `heuristic` for most users**, and a report covered in `heuristic` tags is a less impressive artifact than the same report with no tags at all. This costs conversions. It is the point.
- Every estimate must be constructed as an `Estimate` with a basis and a source string, which is more verbose than a number at every call site in the engine.
- `weakestBasis()` means one weak input downgrades an otherwise well-evidenced figure. This is correct and occasionally feels harsh — a cost figure with excellent telemetry still reads `heuristic` if displacement is assumed. The alternative is worse.

## Alternatives considered

**Confidence intervals instead of rungs.** Rejected: an interval implies a distribution, and there is no distribution behind a rubric weight someone chose. It would be false precision applied to the problem of false precision.

**A single `estimated` / `measured` boolean.** Rejected: it collapses a list price and a rule of thumb into the same bucket, which is the specific failure the ladder exists to fix.

**Confidence percentages.** Rejected: unfalsifiable, and users read them as accuracy.

**A disclaimer paragraph.** Rejected, at length, above.
