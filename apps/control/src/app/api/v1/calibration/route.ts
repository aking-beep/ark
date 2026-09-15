import { NextResponse } from 'next/server';
import {
  calibration, persistCalibrationSnapshot, orgFromBearer, bearerFrom, verifySession,
} from '@ark/db';
import { COOKIE, WINDOW_DAYS, sessionSecret } from '@/lib/org';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

async function orgOf(req: Request): Promise<string | null> {
  const fromToken = await orgFromBearer(bearerFrom(req));
  if (fromToken) return fromToken.orgId;
  const session = await verifySession(cookieValue(req.headers.get('cookie'), COOKIE), sessionSecret());
  return session?.orgId ?? null;
}

export async function GET(req: Request) {
  const orgId = await orgOf(req);
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? WINDOW_DAYS)));
  const force = url.searchParams.get('snapshot') === '1';

  const set = await calibration(orgId, days);
  await persistCalibrationSnapshot(orgId, days, set, force ? 0 : 60_000);

  return NextResponse.json(set, {
    headers: {
      'cache-control': 'private, max-age=60, stale-while-revalidate=300',
    },
  });
}
