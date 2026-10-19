import { BasisTag } from '@ark/ui';
import { TRACE_FLOOR, type BasisClaim } from '@/lib/basis';

/**
 * A BasisTag for a Control figure, plus the floor warning in visible text:
 * the tag's source is a tooltip, and a thin sample should not need a hover
 * to admit it is thin.
 */
export function Basis({ claim }: { claim: BasisClaim }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
      <BasisTag basis={claim.basis} source={claim.source} sampleSize={claim.sampleSize} />
      {claim.belowFloor && <span className="text-2xs text-ink-300">below the {TRACE_FLOOR}-trace floor</span>}
    </span>
  );
}
