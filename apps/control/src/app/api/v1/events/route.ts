import { NextResponse } from 'next/server';
import { applyIngest, deliverAlerts, orgFromBearer, bearerFrom } from '@ark/db';
import { PROTOCOL_SPEC_VERSIONS } from '@ark/protocols';
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
      evidence: [
        {
          id: 'pe_1', traceId: 'tr_1', workloadId: 'wl_support_triage',
          protocol: 'mcp', protocolVersion: PROTOCOL_SPEC_VERSIONS.mcp,
          kind: 'tool', operation: 'tools/call:search_customer',
          actor: 'support-agent', target: 'crm-mcp',
          outcome: 'ok', latencyMs: 84, risk: 'low', requiredApproval: false,
          metadata: { transport: 'streamable-http', isError: false },
        },
        {
          id: 'pe_2', traceId: 'tr_1', workloadId: 'wl_support_triage',
          protocol: 'ap2', protocolVersion: PROTOCOL_SPEC_VERSIONS.ap2,
          kind: 'payment', operation: 'payment_mandate',
          actor: 'procurement-agent', target: 'aws',
          outcome: 'approved', valueUsd: 475, currency: 'USD',
          requiredApproval: true, approvedBy: 'user_12',
          risk: 'high', evidenceRef: 'mandate_829',
          metadata: { presence: 'human_present', mandateType: 'PaymentMandate' },
        },
      ],
    },
    notes: [
      'orgId in the body must match the token, or be omitted.',
      'costUsd is optional. Omit it and Control prices the call from its own rate card.',
      'sample is scanned for sensitive patterns and then discarded. It is never stored.',
      'Posting the same event id twice is a no-op, so retries are safe. The same holds for evidence ids.',
      'A budget in block refuses further events and returns circuitBreaks.reason budget_block.',
      'Prefer @ark/sdk — it assigns trace ids and turn indices so cost per outcome stays honest.',
      'evidence[] is one normalised protocol observation per row. It is a separate grain from events: an event is one model call and is priced, an observation is one thing an agent did over a protocol and is governed.',
      'evidence.metadata takes scalars only — at most 32 keys, strings at most 200 characters. A nested object or array is a 422, because that is how a tool-argument blob arrives.',
      'Control redacts evidence metadata again before storing it, dropping keys that name a payload or a credential and values that trip the sensitive-data detectors. The dropped key names come back to you in evidenceRedacted and are not stored; the sensitive_data alert records how many fields fell and what class each fell into, because a key name can itself be the sensitive value. Fix the sender.',
      'Normalise with @ark/protocols rather than hand-building evidence: its adapters construct output from an allowlist, so a payload field has no path in at all.',
      'requiredApproval with no approvedBy on an outcome of ok or approved raises approval_missing. An outcome of pending does not — an approval in flight is not a finding.',
    ],
  });
}
