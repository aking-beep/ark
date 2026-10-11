import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import { raw } from './queries.js';

export interface AlertToDeliver {
  kind: string;
  severity: string;
  workloadId: string | null;
  message: string;
}

export interface DeliverOpts {
  client?: Client;
  fetchFn?: typeof fetch;
  /** Per-request ceiling. */
  timeoutMs?: number;
  /**
   * Ceiling on the whole call. Deliveries run in parallel and anything still
   * in flight at this point is abandoned and recorded as a timeout, so a dead
   * destination costs the ingest response at most this long.
   */
  deadlineMs?: number;
  /** At most this many alerts are delivered per call; the rest stay in the alerts table. */
  maxAlerts?: number;
}

export const DELIVERY_DEADLINE_MS = 5_000;

interface Outcome {
  destId: string;
  kind: string;
  ok: boolean;
  status: number | null;
  error: string | null;
}

/**
 * POST alerts to the org's webhook/Slack destinations. Ingest has already
 * committed; a dead destination must not turn a 202 into a 500, and a slow
 * one must not hold the response open. The caller passes only alerts that
 * were newly stored, so a retried batch does not page anyone twice.
 */
export async function deliverAlerts(
  orgId: string,
  alerts: AlertToDeliver[],
  opts: DeliverOpts = {},
): Promise<{ attempted: number; ok: number }> {
  if (alerts.length === 0) return { attempted: 0, ok: 0 };
  const c = opts.client ?? raw();
  const fetchFn = opts.fetchFn ?? fetch;
  const deadlineMs = opts.deadlineMs ?? DELIVERY_DEADLINE_MS;
  const timeoutMs = Math.min(opts.timeoutMs ?? 3_000, deadlineMs);
  const batch = alerts.slice(0, opts.maxAlerts ?? 25);
  const dests = await c.execute({
    sql: 'SELECT id, kind, url FROM alert_destinations WHERE org_id=?',
    args: [orgId],
  });
  if (dests.rows.length === 0) return { attempted: 0, ok: 0 };

  const controllers: AbortController[] = [];
  let expired = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    deadlineTimer = setTimeout(() => {
      expired = true;
      for (const ac of controllers) ac.abort();
      resolve();
    }, deadlineMs);
  });

  const deliverOne = async (destId: string, kind: string, url: string, a: AlertToDeliver): Promise<Outcome> => {
    const ac = new AbortController();
    controllers.push(ac);
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const body = kind === 'slack'
        ? { text: `[${a.severity}] ${a.kind}: ${a.message}` }
        : {
            orgId,
            kind: a.kind,
            severity: a.severity,
            workloadId: a.workloadId,
            message: a.message,
            ts: Date.now(),
          };
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      return { destId, kind: a.kind, ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
    } catch (err) {
      const error = ac.signal.aborted
        ? `timeout after ${expired ? deadlineMs : timeoutMs}ms`
        : (err instanceof Error ? err.message : 'deliver failed');
      return { destId, kind: a.kind, ok: false, status: null, error };
    } finally {
      clearTimeout(timer);
    }
  };

  const tasks: Promise<Outcome>[] = [];
  const pending: Array<{ destId: string; kind: string }> = [];
  for (const d of dests.rows) {
    for (const a of batch) {
      pending.push({ destId: String(d.id), kind: a.kind });
      tasks.push(deliverOne(String(d.id), String(d.kind), String(d.url), a));
    }
  }

  // A fetch that ignores its abort signal still cannot hold this past the
  // deadline: whatever has not settled by then is recorded as timed out.
  const settled: Array<Outcome | undefined> = new Array(tasks.length);
  tasks.forEach((t, i) => t.then((o) => { settled[i] = o; }));
  await Promise.race([Promise.allSettled(tasks), deadline]);
  clearTimeout(deadlineTimer);

  const outcomes: Outcome[] = pending.map((p, i) => settled[i] ?? {
    ...p, ok: false, status: null, error: `timeout after ${deadlineMs}ms`,
  });

  const ts = Date.now();
  await c.batch(outcomes.map((o) => ({
    sql: `INSERT INTO alert_deliveries (id, org_id, destination_id, alert_kind, ts, ok, status, error)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [`dl_${ts}_${randomUUID()}`, orgId, o.destId, o.kind, ts, o.ok ? 1 : 0, o.status, o.error],
  })), 'write');

  return { attempted: outcomes.length, ok: outcomes.filter((o) => o.ok).length };
}
