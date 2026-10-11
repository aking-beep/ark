import { NextResponse } from 'next/server';
import { Workload } from '@ark/core';
import {
  MEASURE_TIMEOUT_MS,
  SAMPLE_WORKLOAD_PREFIX,
  measureEnabled,
  measureGate,
  measureWorkload,
  sampleWorkloadId,
} from '@/lib/measure';
import { MAX_BODY_BYTES, RateLimiter, clientIp, readJsonBody } from '@/lib/request-guard';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  'not-ai': 422,
  no_provider: 503,
  timeout: 504,
  execution_failed: 502,
};

/** Each sample spends real model tokens: 5 per minute per client address. */
const limiter = new RateLimiter(5, 60_000);
/** And 30 per minute across every client, which address rotation cannot escape. */
const globalLimiter = new RateLimiter(30, 60_000);

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * First-party Runtime caller. One synthetic sample for a teams workload,
 * ingested to Control when ARK_CONTROL_URL is set. Not a model gateway —
 * the report still estimates; this is the opt-in measurement.
 *
 * Off unless ARK_MEASURE_ENABLED=1. Rate limited per client. The workload id
 * is forced into the `teams_sample_` namespace so a caller cannot write
 * traces into a real workload.
 */
export async function POST(req: Request) {
  const refused = measureGate(clientIp(req), limiter, process.env, globalLimiter);
  if (refused) {
    return NextResponse.json(refused.body, { status: refused.status, headers: refused.headers });
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE });
  }

  const parsed = Workload.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Body must be a Workload.', issues: parsed.error.issues },
      { status: 422, headers: NO_STORE },
    );
  }

  const out = await measureWorkload(parsed.data);
  if (!out.ok) {
    return NextResponse.json(
      { ok: false, reason: out.reason, message: out.message, verdict: out.verdict ?? null },
      { status: STATUS[out.reason] ?? 500, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      verdict: out.verdict,
      workloadId: sampleWorkloadId(parsed.data.id),
      modelId: out.result.modelId,
      adapterId: out.result.adapterId,
      latencyMs: out.result.latencyMs,
      cost: out.result.cost,
      // Outcome only: Control's error text stays on the server.
      telemetry: { attempted: out.result.telemetry.attempted, ok: out.result.telemetry.ok },
      routing: { selected: out.result.routing.selected, rationale: out.result.routing.rationale },
    },
    { headers: NO_STORE },
  );
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/measure',
    enabled: measureEnabled(),
    accepts: `A Workload object (the same shape as POST /api/assess), at most ${MAX_BODY_BYTES} bytes.`,
    returns:
      'One Runtime sample: model, latency, cost estimate, and whether Control ingest succeeded. not-ai is 422 and does not call a provider.',
    prompt: 'Synthetic. Workload id and task shapes only — never the description.',
    workloadId: `Recorded as ${SAMPLE_WORKLOAD_PREFIX}<id>, never the raw id.`,
    rateLimit: '5 samples per minute per client address.',
    env: {
      ARK_MEASURE_ENABLED: 'Must be 1. Unset = POST returns 404 and no model is called.',
      ARK_CONTROL_URL: 'Control origin. Unset = sample still runs, ingest is skipped and telemetry.ok is false.',
      ARK_CONTROL_TOKEN: 'Bearer matching an org_tokens row.',
      ARK_OLLAMA_URL: 'Local adapter. Other adapters follow Runtime from-env rules.',
      ARK_OLLAMA_MODEL:
        'Installed Ollama tag for the sample. Catalog ids like local-70b are estimates, not tags.',
    },
    timeoutMs: MEASURE_TIMEOUT_MS,
    note: 'This is not a gateway. It does not sit in the request path of production traffic. A timed-out sample is cancelled and not ingested.',
  });
}
