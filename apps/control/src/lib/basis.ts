/**
 * Which basis a Control figure may claim. No Next or @ark imports, so
 * basis.test.ts runs under plain `node --test`.
 *
 * Control observes; it does not invoice. A count or a rate taken from ingested
 * telemetry is a measurement of this org's system. A dollar figure is only a
 * measurement when every event behind it carried the cost the caller was
 * actually charged — the moment ARK priced one from the catalog's list rates,
 * the total is observed tokens times somebody's rate card, which is close to
 * the bill and is not the bill.
 */

export type ControlBasis = 'heuristic' | 'benchmark' | 'calibrated' | 'measured';

/** Below this many traces a figure says so, the same floor calibration uses. */
export const TRACE_FLOOR = 30;

export interface BasisClaim {
  basis: ControlBasis;
  /** Shown in the tag's tooltip: where the number came from, in one line. */
  source: string;
  sampleSize: number;
  belowFloor: boolean;
}

/**
 * How the dollars in a window were priced. `reportedCostEvents` is how many
 * events carried a caller-reported cost; `null` means ingest did not record
 * the difference, so no event can be shown to have carried one.
 */
export interface CostProvenance {
  events: number;
  reportedCostEvents: number | null;
}

const floorNote = (n: number) =>
  n < TRACE_FLOOR ? `; below the ${TRACE_FLOOR}-trace floor — too few to rely on` : '';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Counts and rates computed from ingested telemetry: units, success rate, turns. */
export function telemetryBasis(traces: number): BasisClaim {
  return {
    basis: 'measured',
    source: `${plural(traces, 'trace')} of this org's ingested telemetry${floorNote(traces)}`,
    sampleSize: traces,
    belowFloor: traces < TRACE_FLOOR,
  };
}

/** A dollar figure summed or divided from event costs. */
export function dollarBasis(traces: number, cost: CostProvenance): BasisClaim {
  const reported = cost.reportedCostEvents;
  const allReported = reported != null && cost.events > 0 && reported >= cost.events;
  let source: string;
  if (allReported) {
    source = `caller-reported cost on all ${plural(cost.events, 'event')} across ${plural(traces, 'trace')}`;
  } else if (reported == null) {
    source =
      `observed tokens from ${plural(traces, 'trace')}, priced at catalog list rates — not your invoice. ` +
      'Ingest does not record which costs a caller reported, so none is counted as reported';
  } else if (reported > 0) {
    // Floored, so 399 of 400 reads 99% rather than a rounded 100% that
    // would contradict the basis next to it.
    const share = reported / Math.max(1, cost.events);
    const pct = share < 0.01 ? '<1' : String(Math.floor(share * 100));
    source =
      `observed tokens from ${plural(traces, 'trace')}; ${pct}% of events carried a caller-reported cost and the rest ` +
      'were priced at catalog list rates — not your invoice';
  } else {
    source = `observed tokens from ${plural(traces, 'trace')}, priced at catalog list rates — not your invoice`;
  }
  return {
    basis: allReported ? 'measured' : 'calibrated',
    source: source + floorNote(traces),
    sampleSize: traces,
    belowFloor: traces < TRACE_FLOOR,
  };
}

/**
 * A dollar figure Control projects rather than observes — a straight-line
 * extrapolation, a counterfactual price. It is never stronger than the dollars
 * it rests on, and never `measured`: nobody has observed a future month.
 */
export function projectionBasis(from: BasisClaim, how: string): BasisClaim {
  return {
    basis: 'heuristic',
    source: `${how}, from ${from.basis} figures over ${plural(from.sampleSize, 'trace')}${floorNote(from.sampleSize)}`,
    sampleSize: from.sampleSize,
    belowFloor: from.belowFloor,
  };
}

/**
 * The weaker of two bases. A dollar total priced from the catalog stays
 * `calibrated` even when the call shape under it was measured.
 */
export function weaker(a: ControlBasis, b: ControlBasis): ControlBasis {
  const rank: Record<ControlBasis, number> = { heuristic: 0, benchmark: 1, calibrated: 2, measured: 3 };
  return rank[a] <= rank[b] ? a : b;
}
