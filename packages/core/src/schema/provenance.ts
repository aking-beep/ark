/**
 * Provenance is the spine of this system.
 *
 * Every number ARK shows a user carries a record of where it came from. The
 * failure mode this exists to prevent: an assessment tool that emits
 * "$0.09 per ticket, 84/100 suitability" with the same visual confidence
 * whether that came from ten thousand observed production calls or from a
 * rubric someone wrote on a Tuesday.
 *
 * A number without a basis is a guess wearing a lab coat.
 */

/** Where a number came from, weakest to strongest. */
export type Basis =
  /** A rubric or rule of thumb encoded in this repo. No data behind it. */
  | 'heuristic'
  /** Published third-party benchmark or vendor-stated figure. */
  | 'benchmark'
  /** Derived from ARK Control telemetry across other organizations' workloads. */
  | 'calibrated'
  /** Derived from THIS organization's own ARK Control telemetry. */
  | 'measured';

export const BASIS_RANK: Record<Basis, number> = {
  heuristic: 0,
  benchmark: 1,
  calibrated: 2,
  measured: 3,
};

export type Confidence = 'low' | 'medium' | 'high';

export interface Estimate<T = number> {
  value: T;
  /** Lower/upper bound of a plausible range, where one is meaningful. */
  low?: T;
  high?: T;
  basis: Basis;
  confidence: Confidence;
  /** Human-readable pointer to the origin: a rubric name, a doc URL, a query. */
  source: string;
  /** Number of observations behind a calibrated/measured value. */
  sampleSize?: number;
  /** ISO date the underlying data was captured. */
  asOf?: string;
}

export function estimate<T>(
  value: T,
  basis: Basis,
  source: string,
  opts: Partial<Omit<Estimate<T>, 'value' | 'basis' | 'source'>> = {},
): Estimate<T> {
  return {
    value,
    basis,
    source,
    confidence: opts.confidence ?? defaultConfidence(basis, opts.sampleSize),
    ...opts,
  };
}

function defaultConfidence(basis: Basis, sampleSize?: number): Confidence {
  if (basis === 'heuristic') return 'low';
  if (basis === 'benchmark') return 'medium';
  if (sampleSize === undefined) return 'medium';
  if (sampleSize >= 1000) return 'high';
  if (sampleSize >= 100) return 'medium';
  return 'low';
}

/**
 * The plain-language caveat rendered next to a number in every ARK surface.
 * Deliberately blunt. If we cannot say where a number came from, the user
 * should be told that in words, not left to infer it from a tooltip.
 */
export function describeBasis(e: Estimate<unknown>): string {
  switch (e.basis) {
    case 'measured':
      return `Measured from your own telemetry${e.sampleSize ? ` (${fmt(e.sampleSize)} observations)` : ''}.`;
    case 'calibrated':
      return `Calibrated from comparable workloads in ARK Control${e.sampleSize ? ` (${fmt(e.sampleSize)} observations)` : ''}, not your own.`;
    case 'benchmark':
      return `Published figure${e.asOf ? ` as of ${e.asOf}` : ''}. Verify before you rely on it.`;
    case 'heuristic':
      return 'Rule of thumb. No measurement behind this — treat it as a starting hypothesis, not a forecast.';
  }
}

/** True when the whole report rests on rules of thumb. Surfaces a banner. */
export function isUncalibrated(estimates: Estimate<unknown>[]): boolean {
  return estimates.every((e) => BASIS_RANK[e.basis] <= 1);
}

/** The weakest link. A report is only as trustworthy as its softest input. */
export function weakestBasis(estimates: Estimate<unknown>[]): Basis {
  return estimates.reduce<Basis>(
    (worst, e) => (BASIS_RANK[e.basis] < BASIS_RANK[worst] ? e.basis : worst),
    'measured',
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}
