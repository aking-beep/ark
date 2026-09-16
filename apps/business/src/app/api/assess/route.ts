import { NextResponse } from 'next/server';
import { Workload, assess, fetchCalibration } from '@ark/core';

export const dynamic = 'force-dynamic';

/**
 * Programmatic assessment.
 *
 * The same engine the report page uses, exposed so a team can score a whole
 * backlog of candidate workloads in CI rather than filling in a form eight
 * times. The response is the full Assessment object, including the trust
 * block — a caller that wants only the verdict still has to receive, and
 * therefore can still log, what that verdict rests on.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const isBatch = Array.isArray(body);
  const parsed = isBatch ? Workload.array().safeParse(body) : Workload.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Body must be a Workload or an array of Workloads.', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // One calibration fetch for the whole batch: it is the same window for all
  // of them, and hammering Control once per workload would be rude.
  const calibration = await fetchCalibration({ days: 30 });
  const workloads: Workload[] = isBatch
    ? (parsed.data as Workload[])
    : [parsed.data as Workload];

  const results = workloads.map((w) => {
    const a = assess(w, { depth: 'business', calibration });
    return {
      id: w.id,
      name: w.name,
      verdict: a.suitability.verdict,
      headline: a.suitability.headline,
      blockers: a.suitability.blockers,
      pattern: a.architecture.pattern,
      modelId: a.model.primary.id,
      costPerUnit: a.cost.perUnit,
      costPerMonth: a.cost.perMonth,
      buildCost: a.buildCost,
      paybackMonths: a.value.paybackMonths,
      risk: { level: a.security.level, score: a.security.score, blocking: a.security.controls.filter((c) => c.blocking).map((c) => c.id) },
      trust: a.trust,
      assessment: a,
    };
  });

  return NextResponse.json(isBatch ? results : results[0], {
    headers: { 'cache-control': 'no-store' },
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/assess',
    accepts: 'A Workload object, or an array of them.',
    returns: 'The full Assessment, including the provenance basis of every figure.',
    note:
      'Calibration is fetched from ARK_CONTROL_URL when set. When it is not, the assessment still runs and every cost figure is labelled heuristic rather than silently downgraded. POST /api/measure sends one Runtime sample to Control for the same Workload.',
    calibrated: Boolean(process.env.ARK_CONTROL_URL),
    example: {
      id: 'wl_example',
      name: 'Triage inbound support tickets',
      task: ['classify', 'summarize'],
      volume: { unitsPerMonth: 4000, unitLabel: 'ticket' },
      input: { avgTokens: 1200, requiresExternalKnowledge: false },
      output: { avgTokens: 250, mustBeStructured: true },
      determinism: 'tolerant',
      errorTolerance: 'medium',
      dataClasses: ['internal', 'pii'],
      autonomy: 'suggest',
      current: { minutesPerUnit: 6, fullyLoadedHourlyUsd: 62 },
      team: { engineers: 2, hasMlExperience: false },
    },
  });
}
