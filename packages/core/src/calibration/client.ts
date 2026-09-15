import { CalibrationSet } from './priors.js';

/**
 * How AIFit reaches ARK Control.
 *
 * Deliberately a network call rather than a shared database import. The two
 * products must be separable — a customer can buy the assessment without
 * handing over telemetry, and can buy telemetry without ever opening the
 * assessment. The coupling is a documented HTTP contract, not a schema.
 *
 * Every failure mode here returns null rather than throwing, because the
 * correct behaviour when calibration is unavailable is to fall back to the
 * rubric and say so — not to fail the assessment.
 */
export async function fetchCalibration(opts: {
  baseUrl?: string | undefined;
  orgId?: string | undefined;
  days?: number | undefined;
  timeoutMs?: number | undefined;
  token?: string | undefined;
} = {}): Promise<CalibrationSet | null> {
  const base = opts.baseUrl ?? process.env.ARK_CONTROL_URL;
  if (!base) return null;

  const url = new URL('/api/v1/calibration', base);
  if (opts.orgId) url.searchParams.set('org', opts.orgId);
  url.searchParams.set('days', String(opts.days ?? 30));

  const headers: Record<string, string> = { accept: 'application/json' };
  const token = opts.token ?? process.env.ARK_CONTROL_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 2500);
  try {
    const res = await fetch(url, { signal: ac.signal, headers });
    if (!res.ok) return null;
    const parsed = CalibrationSet.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
