import { NextResponse } from 'next/server';
import { Workload } from '@ark/core';
import { measureWorkload } from '@/lib/measure';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  'not-ai': 422,
  no_provider: 503,
  timeout: 504,
  execution_failed: 502,
};

/**
 * First-party Runtime caller. One synthetic sample for a teams workload,
 * ingested to Control when ARK_CONTROL_URL is set. Not a model gateway —
 * the report still estimates; this is the opt-in measurement.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const parsed = Workload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Body must be a Workload.', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const out = await measureWorkload(parsed.data);
  if (!out.ok) {
    return NextResponse.json(
      { ok: false, reason: out.reason, message: out.message, verdict: out.verdict ?? null },
      { status: STATUS[out.reason] ?? 500, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      verdict: out.verdict,
      modelId: out.result.modelId,
      adapterId: out.result.adapterId,
      latencyMs: out.result.latencyMs,
      cost: out.result.cost,
      telemetry: out.result.telemetry,
      routing: { selected: out.result.routing.selected, rationale: out.result.routing.rationale },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/measure',
    accepts: 'A Workload object (the same shape as POST /api/assess).',
    returns:
      'One Runtime sample: model, latency, cost estimate, and whether Control ingest succeeded. not-ai is 422 and does not call a provider.',
    prompt: 'Synthetic. Workload id and task shapes only — never the description.',
    env: {
      ARK_CONTROL_URL: 'Control origin. Unset = sample still runs, ingest is skipped and telemetry.ok is false.',
      ARK_CONTROL_TOKEN: 'Bearer matching an org_tokens row.',
      ARK_OLLAMA_URL: 'Local adapter. Other adapters follow Runtime from-env rules.',
    },
    timeoutMs: 15_000,
    note: 'This is not a gateway. It does not sit in the request path of production traffic.',
  });
}
