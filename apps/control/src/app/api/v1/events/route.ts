import { NextResponse } from 'next/server';
import { applyIngest } from '@ark/db';
import { IngestBody, allowlist, authorize } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Above this many turns in a single trace, something is looping. */
const TURN_CEILING = Number(process.env.ARK_TURN_CEILING ?? 25);
/** Above this cost for a single unit of work, stop and look. */
const TRACE_COST_CEILING = Number(process.env.ARK_TRACE_COST_CEILING ?? 1.0);

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = IngestBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 422 });
  }

  const result = await applyIngest(parsed.data, {
    allowlist: allowlist(),
    turnCeiling: TURN_CEILING,
    traceCostCeiling: TRACE_COST_CEILING,
  });

  return NextResponse.json(
    {
      ...result,
      /**
       * The caller is expected to act on this. Control can observe a runaway
       * loop but it cannot reach into your process and stop it — the SDK that
       * posts events is what enforces the break.
       */
    },
    { status: 202 },
  );
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/v1/events',
    auth: process.env.ARK_INGEST_TOKEN ? 'Bearer token required' : 'open (set ARK_INGEST_TOKEN to require one)',
    body: {
      orgId: 'org_demo',
      events: [{
        id: 'ev_1', traceId: 'tr_1', workloadId: 'wl_support_triage',
        provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: 0,
        inputTokens: 2400, outputTokens: 180, cachedInputTokens: 1800,
        latencyMs: 820, status: 'ok',
      }],
      traces: [{ traceId: 'tr_1', workloadId: 'wl_support_triage', outcome: 'success', retries: 0 }],
      actions: [{
        id: 'ac_1', traceId: 'tr_1', workloadId: 'wl_support_triage',
        name: 'Issue refund', system: 'Salesforce', blastRadius: 'costly',
        requiredApproval: true, approvedBy: 'user_12',
      }],
      qualitySamples: [{
        id: 'qs_1', workloadId: 'wl_support_triage', traceId: 'tr_1',
        correct: true, judgedBy: 'human',
      }],
    },
    notes: [
      'costUsd is optional. Omit it and Control prices the call from its own rate card.',
      'sample is scanned for sensitive patterns and then discarded. It is never stored.',
      'Posting the same event id twice is a no-op, so retries are safe.',
      'actions and qualitySamples are optional. An irreversible action with no approvedBy raises unapproved_action.',
      'Prefer @ark/sdk — it assigns trace ids and turn indices so cost per outcome stays honest.',
    ],
  });
}
