import { NextResponse } from 'next/server';
import {
  calibration, persistCalibrationSnapshot, orgFromBearer, bearerFrom, verifySession, hasMembership,
} from '@ark/db';
import { COOKIE, WINDOW_DAYS, sessionSecret } from '@/lib/org';
import { parseDays } from '@/lib/guards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** At most one snapshot row per org per minute, however the request is phrased. */
const SNAPSHOT_INTERVAL_MS = 60_000;

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

async function orgOf(req: Request): Promise<string | null> {
  const fromToken = await orgFromBearer(bearerFrom(req));
  if (fromToken) return fromToken.orgId;
  const session = await verifySession(cookieValue(req.headers.get('cookie'), COOKIE), sessionSecret());
  if (!session) return null;
  return (await hasMembership(session.userId, session.orgId)) ? session.orgId : null;
}

export async function GET(req: Request) {
  const orgId = await orgOf(req);
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = parseDays(url.searchParams.get('days'), WINDOW_DAYS);
  // `snapshot=1` used to bypass the interval, which let any token holder
  // write a row per request. It is accepted for compatibility and now obeys
  // the same per-org interval as every other read.
  const set = await calibration(orgId, days);
  await persistCalibrationSnapshot(orgId, days, set, SNAPSHOT_INTERVAL_MS);

  return NextResponse.json(set, {
    headers: {
      'cache-control': 'private, max-age=60, stale-while-revalidate=300',
    },
  });
}
