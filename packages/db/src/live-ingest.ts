/**
 * Post live traces for org_northwind through applyIngest — the same path as
 * POST /api/v1/events. Seed creates the org with zero events; this is what
 * replaces SQL-inserted telemetry for that tenant.
 */
import { pathToFileURL } from 'node:url';
import { applyIngest } from './ingest.js';
import { NW_ORG, NORTHWIND_CLAIMS } from './northwind.js';
import { IngestBody } from '@ark/core';

const TRACES = Number(process.env.ARK_LIVE_TRACES ?? 40);

export async function ingestLive(opts: { traces?: number } = {}): Promise<{ accepted: number; traces: number }> {
  const n = opts.traces ?? TRACES;
  let accepted = 0;
  for (let i = 0; i < n; i++) {
    const traceId = `tr_live_${i}_${Date.now().toString(36)}`;
    const events = [0, 1, 2].map((turn) => ({
      id: `ev_live_${i}_${turn}`,
      traceId,
      workloadId: NORTHWIND_CLAIMS.id,
      provider: 'anthropic' as const,
      modelId: 'claude-haiku-4.5',
      turn,
      inputTokens: 400 + turn * 80,
      outputTokens: 120,
      cachedInputTokens: turn > 0 ? 200 : 0,
      latencyMs: 400,
      status: 'ok' as const,
    }));
    const body = IngestBody.parse({
      orgId: NW_ORG,
      events,
      traces: [{
        traceId,
        workloadId: NORTHWIND_CLAIMS.id,
        outcome: 'success',
        retries: 0,
        endedAt: Date.now(),
      }],
    });
    const r = await applyIngest(body, {
      allowlist: ['anthropic', 'openai', 'google', 'local'],
      turnCeiling: 25,
      traceCostCeiling: 1,
    });
    accepted += r.accepted;
  }
  return { accepted, traces: n };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await ingestLive();
  console.log(`Live-ingested ${r.traces} traces (${r.accepted} events) for ${NW_ORG}.`);
}
