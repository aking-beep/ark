# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Engineers (and later design work) shipping **AI Fit Teams** and **ARK Control**. This package is not a visitor-facing product and has no end-user login, funnel, or homepage.

AI Fit (consumer) does **not** consume this kit. Consumer has its own stack (Next 16, Geist, its own components).

*(Inferred from workspace package.json files and `packages/ui` source. Confirmed as an init target by the owner.)*

## Product Purpose

Shared component vocabulary and Tailwind preset so provenance and instrument-panel language cannot drift between the estimator and the measurement plane.

The load-bearing export is `BasisTag`. If a figure appears without it, that figure is lying by omission. Dimension score thresholds live here so Teams and Control colour the same score the same way.

Success is: one `BasisTag`, one panel/stat/badge language, used by both surfaces; no form controls leaking into the shared package.

## Positioning

Not a design-system product for sale. Not six protocol dashboards. Not the consumer visual world. A neighbouring UI kit could copy a dark table; it could not truthfully be the single place the provenance ladder is rendered for both the guess and the measurement.

## Operating Context

- Package `@ark/ui`, built with `tsc`, peer React 18.
- Consumed by `apps/business` and `apps/control`.
- Tailwind preset: `packages/ui/tailwind-preset.cjs` (ink / signal instrument chrome). Changing it restyles both Teams and Control; it must not be edited to restyle consumer.
- No dedicated port, app, or `npm run dev` of its own.

## Capabilities and Constraints

**Exports today:** `cx`, `Panel`, `Grid`, `Stat`, `Badge`, `BasisTag`, `Meter`, `Sparkline`, `dimensionTone`, `DimensionList`, `Table`, `Td`, `Callout`, `Button`.

**Deliberately omitted:** form controls. How much to ask, and how, belongs in the apps.

**Basis ladder (fixed vocabulary):** `heuristic` | `benchmark` | `calibrated` | `measured`.

**Constraint:** consumer restyles must not modify this preset or these primitives to pick up cream/terracotta.

**Open:** no public name beyond `@ark/ui`. No accessibility standard recorded in init.

## Brand Commitments

This kit inherits the family claim: a guess and a measurement never look the same on screen. `BasisTag` copy explains each rung (heuristic is a starting hypothesis; measured is observed in your own running system).

No separate brand, logo, or marketing site.

## Evidence on Hand

- Source: `packages/ui/src/primitives.tsx`, `packages/ui/tailwind-preset.cjs`.
- Call sites in `apps/business` and `apps/control`.
- Architecture note in `docs/01-architecture.md` (shared UI / no form controls).

**Do not fabricate:** a Figma library, published Storybook, or consumer usage.

## Product Principles

1. Provenance is a component, not a disclaimer.
2. One threshold for dimension colouring across Teams and Control.
3. Shared vocabulary, not shared forms.
4. Consumer is a different visual world; this kit does not absorb it.
