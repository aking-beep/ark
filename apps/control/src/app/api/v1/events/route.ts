import { NextResponse } from 'next/server';
import { applyIngest, deliverAlerts, orgFromBearer, bearerFrom } from '@ark/db';
import { IngestBody, allowlist } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TURN_CEILING = Number(process.env.ARK_TURN_CEILING ?? 25);
const TRACE_COST_CEILING = Number(process.env.ARK_TRACE_COST_CEILING ?? 1.0);

export async function POST(req: Request) {
  const caller = await orgFromBearer(bearerFrom(req));
  if (!caller) {
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

  if (parsed.data.orgId && parsed.data.orgId !== caller.orgId) {
    return NextResponse.json({ error: 'org_mismatch' }, { status: 403 });
  }

  const result = await applyIngest(
    { ...parsed.data, orgId: caller.orgId },
    {
      allowlist: allowlist(),
      turnCeiling: TURN_CEILING,
      traceCostCeiling: TRACE_COST_CEILING,
    },
  );

  const { alertRecords, ...publicResult } = result;
  try {
    await deliverAlerts(caller.orgId, alertRecords ?? []);
  } catch {
    // Destinations are best-effort. The batch is already persisted.
  }

  return NextResponse.json(publicResult, { status: 202 });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/v1/events',
    auth: 'Bearer org ingest token (see org_tokens). Open only before the first token is seeded.',
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
      'orgId in the body must match the token, or be omitted.',
      'costUsd is optional. Omit it and Control prices the call from its own rate card.',
      'sample is scanned for sensitive patterns and then discarded. It is never stored.',
      'Posting the same event id twice is a no-op, so retries are safe.',
      'A budget in block refuses further events and returns circuitBreaks.reason budget_block.',
      'Prefer @ark/sdk — it assigns trace ids and turn indices so cost per outcome stays honest.',
    ],
  });
}
