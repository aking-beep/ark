/**
 * Colour follows provenance, not optimism.
 *
 * A figure may be painted good, warn or danger only when it rests on
 * telemetry (calibrated or measured). A rubric guess or a vendor benchmark is
 * neutral however good or bad it looks, because green on a guess reads as a
 * fact. Every money or rate figure that wants a tone goes through here.
 */
export type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'signal';

export type BasisName = 'heuristic' | 'benchmark' | 'calibrated' | 'measured';

const EARNS_COLOUR: ReadonlySet<BasisName> = new Set<BasisName>(['calibrated', 'measured']);

export function toneFor(est: { basis: BasisName } | null | undefined, wouldBe: Tone): Tone {
  if (!est) return 'neutral';
  if (wouldBe === 'good' || wouldBe === 'warn' || wouldBe === 'danger') {
    return EARNS_COLOUR.has(est.basis) ? wouldBe : 'neutral';
  }
  return wouldBe;
}
