import { NextResponse } from 'next/server';
import { calibration, persistCalibrationSnapshot } from '@ark/db';
import { ORG_ID, WINDOW_DAYS } from '@/lib/org';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The contract between Control and AIFit.
 *
 * AIFit calls this before every assessment. If it 404s, times out, or returns
 * thin samples, AIFit falls back to its rubric and labels the result
 * `heuristic`. The product degrades honestly instead of silently, which is the
 * whole argument for the provenance ladder existing.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = url.searchParams.get('org') ?? ORG_ID;
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? WINDOW_DAYS)));
  const force = url.searchParams.get('snapshot') === '1';

  const set = await calibration(orgId, days);
  await persistCalibrationSnapshot(orgId, days, set, force ? 0 : 60_000);

  return NextResponse.json(set, {
    headers: {
      // Priors move slowly. A minute of staleness is cheaper than hammering the
      // database on every assessment.
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}
