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
  timeoutMs?: number;
}

/**
 * POST alerts to the org's webhook/Slack destinations. Ingest has already
 * committed; a dead destination must not turn a 202 into a 500.
 */
export async function deliverAlerts(
  orgId: string,
  alerts: AlertToDeliver[],
  opts: DeliverOpts = {},
): Promise<{ attempted: number; ok: number }> {
  if (alerts.length === 0) return { attempted: 0, ok: 0 };
  const c = opts.client ?? raw();
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const dests = await c.execute({
    sql: 'SELECT id, kind, url FROM alert_destinations WHERE org_id=?',
    args: [orgId],
  });
  let attempted = 0;
  let ok = 0;
  let seq = 0;
  for (const d of dests.rows) {
    const destId = String(d.id);
    const kind = String(d.kind);
    const url = String(d.url);
    for (const a of alerts) {
      attempted++;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let status: number | null = null;
      let error: string | null = null;
      let succeeded = false;
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
        status = res.status;
        succeeded = res.ok;
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (err) {
        error = ac.signal.aborted ? `timeout after ${timeoutMs}ms` : (err instanceof Error ? err.message : 'deliver failed');
      } finally {
        clearTimeout(timer);
      }
      if (succeeded) ok++;
      await c.execute({
        sql: `INSERT INTO alert_deliveries (id, org_id, destination_id, alert_kind, ts, ok, status, error)
              VALUES (?,?,?,?,?,?,?,?)`,
        args: [
          `dl_${Date.now()}_${seq++}`,
          orgId,
          destId,
          a.kind,
          Date.now(),
          succeeded ? 1 : 0,
          status,
          error,
        ],
      });
    }
  }
  return { attempted, ok };
}
