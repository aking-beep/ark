import { Intake } from '@/components/intake';
import { decodeWorkload } from '@/lib/encode';
import { parseStep, stateFromWorkload } from '@/lib/intake-state';

export const metadata = { title: 'Assess a workload — AI Fit Teams' };

/**
 * `?w=` is a report's "Edit answers" link (or the short-circuit's "Continue the
 * full assessment"). It is decoded here because the codec needs Buffer; the
 * client form only ever receives plain intake state.
 */
export default async function Assess({
  searchParams,
}: {
  searchParams: Promise<{ w?: string | string[]; step?: string | string[] }>;
}) {
  const { w, step } = await searchParams;
  const encoded = typeof w === 'string' && w.length > 0 ? w : null;
  const workload = encoded ? decodeWorkload(encoded) : null;
  return (
    <Intake
      initial={workload ? stateFromWorkload(workload) : null}
      initialStep={parseStep(step)}
      badLink={encoded !== null && workload === null}
    />
  );
}
