# Diagrams

Five SVGs. Each one exists to make a single argument that prose makes slowly, and each is embedded at the point in the docs where that argument is being made — this file is an index, not a gallery.

They are hand-written SVG rather than generated from a DSL. That is a deliberate trade: no toolchain to install and no build step, at the cost of having to move coordinates by hand when text changes. If a diagram ever needs to be regenerated from data rather than edited, that is the point at which it should stop being an SVG in this folder.

| File | Argument it makes | Embedded in |
|---|---|---|
| [`system-map.svg`](system-map.svg) | Three surfaces share engines in one repo and are joined by exactly one wire. The load-bearing part of the picture is the line that is *absent*: MY AI for teams has no database dependency. | [`01-architecture.md`](../01-architecture.md), [`README.md`](../../README.md) |
| [`trace-vs-event.svg`](trace-vs-event.svg) | The same nineteen model calls, read with and without `events.turn`. One reading says the work cost $0.0072 a ticket; the other says it cost $0.137 and triaged nothing. | [`03-data-model.md`](../03-data-model.md) |
| [`verdict-ladder.svg`](verdict-ladder.svg) | `decideVerdict()` drawn line for line: seven weighted dimensions, then eight gates in evaluation order. Two of the gates return "no", and they are checked first. | [`02-scoring-methodology.md`](../02-scoring-methodology.md) |
| [`provenance-ladder.svg`](provenance-ladder.svg) | The four rungs, and `weakestBasis()` worked end to end on a real payback figure — a `measured` cost times a `heuristic` assumption is a `heuristic` result. | [`02-scoring-methodology.md`](../02-scoring-methodology.md) |
| [`calibration-loop.svg`](calibration-loop.svg) | The six steps that promote a figure from `heuristic` to `measured`, and the sixth step that grades the rubric back. | [`00-thesis.md`](../00-thesis.md) |

## About the numbers in them

Every figure shown — `n=881`, 8.25 turns per outcome, `$0.1371` per outcome, 11,800 events across 2,064 traces — is a snapshot of one run of `npm run db:seed`, not an invented illustration. The seed's PRNG is fixed (`mulberry32(20260914)`), but day boundaries are derived from the current date, so weekend volume shifts and the figures move by a fraction of a percent between runs. Treat them as accurate to two significant figures, which is all any of them is being asked to carry.

The client in the diagrams — Riverbend Supply, and Dana in support — is the seeded demo org. Using a named company and a named person is intentional: an abstract box labelled "workload" can be nodded at, and a figure that says Dana's escalation queue grew cannot.

## Conventions

Colours come from the shared Tailwind preset in [`packages/ui/tailwind-preset.cjs`](../../packages/ui/tailwind-preset.cjs), so a diagram sits next to a screenshot of the product without clashing. The semantic mapping is the same one the UI uses: teal for `measured` and for things that are working, amber for `heuristic` and for things that need attention, red for the failure being argued against, indigo for `benchmark`, green for `calibrated` and bounded automation.

Text is never rotated except for the single trace bracket label, and no diagram relies on a glyph outside the Latin-1 range — `→` in particular is drawn as a path, because it renders as blank space in several common SVG fallback fonts.

## Rendering to PNG

GitHub and most markdown viewers render these inline as-is. To produce raster copies for a deck:

```bash
pip install cairosvg
python3 -c "
import cairosvg, pathlib
for f in pathlib.Path('docs/diagrams').glob('*.svg'):
    cairosvg.svg2png(url=str(f), write_to=str(f.with_suffix('.png')), scale=2)
"
```

PNGs are intentionally not committed. They go stale silently, and the SVG is the source.
