import { NextResponse } from 'next/server';
import { calibration, raw } from '@ark/db';
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
  const persist = url.searchParams.get('snapshot') === '1';

  const set = await calibration(orgId, days);

  if (persist) {
    await raw().execute({
      sql: `INSERT INTO calibration_snapshots (id, org_id, generated_at, window_days, basis, payload)
            VALUES (?,?,?,?,?,?)`,
      args: [`cal_${Date.now()}`, orgId, Date.now(), days, set.basis, JSON.stringify(set)],
    });
  }

  return NextResponse.json(set, {
    headers: {
      // Priors move slowly. A minute of staleness is cheaper than hammering the
      // database on every assessment.
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}
