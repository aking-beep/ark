/**
 * Budget periods, in UTC.
 *
 * A budget row carries `period` (day, week or month). Every reader — the
 * ingest enforcement path, the budget alerts and the Budgets page — must
 * agree on when the current period started, or a block that ingest enforces
 * shows as "ok" on the page. UTC rather than server-local time, because the
 * server's zone is a deployment accident and a container in UTC and a laptop
 * in Los Angeles would otherwise disagree about which day it is.
 *
 * Weeks start on Monday (ISO 8601).
 */
export type BudgetPeriod = 'day' | 'week' | 'month';

export interface PeriodWindow {
  period: BudgetPeriod;
  /** Inclusive start, epoch ms. */
  startMs: number;
  /** Exclusive end, epoch ms. */
  endMs: number;
  /** Stable label for alert ids: 2026-10-11 (day), W2026-10-05 (week), 2026-10 (month). */
  key: string;
}

export function normalisePeriod(raw: unknown): BudgetPeriod {
  return raw === 'day' || raw === 'week' ? raw : 'month';
}

export function periodWindow(raw: unknown, now = Date.now()): PeriodWindow {
  const period = normalisePeriod(raw);
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (period === 'day') {
    const startMs = Date.UTC(y, m, day);
    return { period, startMs, endMs: startMs + 864e5, key: isoDay(startMs) };
  }
  if (period === 'week') {
    const sinceMonday = (d.getUTCDay() + 6) % 7;
    const startMs = Date.UTC(y, m, day - sinceMonday);
    return { period, startMs, endMs: startMs + 7 * 864e5, key: `W${isoDay(startMs)}` };
  }
  const startMs = Date.UTC(y, m, 1);
  const endMs = Date.UTC(y, m + 1, 1);
  return { period, startMs, endMs, key: isoDay(startMs).slice(0, 7) };
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
