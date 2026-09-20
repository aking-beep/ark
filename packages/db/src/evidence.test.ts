import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-evidence-'));
// `queries.ts` opens one lazy client against this URL. Set it before the
// import so the rollups below read the same file applyIngest writes to.
process.env.ARK_DATABASE_URL = `file:${path.join(dir, 'test.db')}`;

const { createClient } = await import('@libsql/client');
const { DDL } = await import('./sql.js');
const { applyIngest } = await import('./ingest.js');
const { protocolSummary, recentEvidence, traceStory, richestProtocolTrace, recentAlerts } =
  await import('./queries.js');
const { IngestBody, detectSensitive } = await import('@ark/core');
const { mcpEvidence, a2aEvidence, agUiEvidence, a2uiEvidence, ucpEvidence, ap2Evidence } =
  await import('@ark/protocols');

const client = createClient({ url: process.env.ARK_DATABASE_URL! });

const opts = {
  client,
  allowlist: ['anthropic', 'openai'],
  turnCeiling: 50,
  traceCostCeiling: 100,
  qualityMinSamples: 20,
};

const ev = (over: Record<string, unknown>) => ({
  id: 'pe_x', protocol: 'mcp', kind: 'tool', operation: 'tools/call:noop', ...over,
});

before(async () => {
  for (const stmt of DDL) await client.execute(stmt);
  for (const [id, name] of [['org_demo', 'Demo'], ['org_other', 'Other']]) {
    await client.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: [id!, name!, Date.now()] });
  }
  await client.execute({
    sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: ['wl_support', 'org_demo', 'Support triage', 'bounded-agent', '{}', null, 'live', Date.now()],
  });
});

describe('protocol evidence ingest', () => {
  test('an evidence-only body parses and is stored', async () => {
    const body = IngestBody.parse({
      evidence: [ev({
        id: 'pe_only', traceId: 'tr_only', workloadId: 'wl_support',
        actor: 'support-agent', target: 'crm-mcp', latencyMs: 84,
      })],
    });
    const r = await applyIngest(body, opts);
    assert.equal(r.evidenceAccepted, 1);
    assert.equal(r.accepted, 0, 'no model events were posted');

    const row = await client.execute({ sql: 'SELECT * FROM protocol_evidence WHERE id=?', args: ['pe_only'] });
    assert.equal(row.rows.length, 1);
    assert.equal(String(row.rows[0]!.protocol), 'mcp');
    assert.equal(String(row.rows[0]!.outcome), 'ok');
    assert.equal(Number(row.rows[0]!.latency_ms), 84);
  });

  test('no protocol observation is written to the model-event table', async () => {
    const events = await client.execute('SELECT COUNT(*) n FROM events');
    assert.equal(Number(events.rows[0]!.n), 0);
  });

  test('evidence names the trace and workload it happened in', async () => {
    const row = await client.execute({ sql: 'SELECT * FROM protocol_evidence WHERE id=?', args: ['pe_only'] });
    assert.equal(String(row.rows[0]!.trace_id), 'tr_only');
    assert.equal(String(row.rows[0]!.workload_id), 'wl_support');

    // Evidence for an unseen trace makes that trace real, so the cross-grain
    // view can find it. It stays pending and carries no cost.
    const trace = await client.execute({ sql: 'SELECT * FROM traces WHERE id=?', args: ['tr_only'] });
    assert.equal(trace.rows.length, 1);
    assert.equal(String(trace.rows[0]!.outcome), 'pending');
    assert.equal(Number(trace.rows[0]!.total_cost_usd), 0);
  });

  test('re-posting the same evidence id is a no-op', async () => {
    const body = IngestBody.parse({
      evidence: [ev({ id: 'pe_only', traceId: 'tr_only', workloadId: 'wl_support', operation: 'tools/call:different' })],
    });
    await applyIngest(body, opts);
    const rows = await client.execute({ sql: 'SELECT operation FROM protocol_evidence WHERE id=?', args: ['pe_only'] });
    assert.equal(rows.rows.length, 1);
    assert.equal(String(rows.rows[0]!.operation), 'tools/call:noop', 'the first write wins; the duplicate changed nothing');
  });

  test('ingest redacts a payload a hand-rolled POST slipped past the SDK', async () => {
    const r = await applyIngest(IngestBody.parse({
      evidence: [ev({
        id: 'pe_leak', workloadId: 'wl_support',
        metadata: { toolArguments: 'accountId=129923', stepName: 'call ada@example.com', transport: 'http' },
      })],
    }), opts);

    // The key names go back to the sender, which is not a place anything is
    // stored. See the block below for what may be written down.
    assert.deepEqual(r.evidenceRedacted, ['stepName', 'toolArguments']);
    const row = await client.execute({ sql: 'SELECT metadata FROM protocol_evidence WHERE id=?', args: ['pe_leak'] });
    const stored = String(row.rows[0]!.metadata);
    assert.ok(!stored.includes('129923'));
    assert.ok(!stored.includes('ada@example.com'));
    assert.ok(stored.includes('http'));
  });
});

describe('the alert that reports a redaction', () => {
  test('says what class of thing was dropped, and how many', async () => {
    await applyIngest(IngestBody.parse({
      evidence: [ev({
        id: 'pe_alert', workloadId: 'wl_support', operation: 'tools/call:leaky',
        metadata: { toolArguments: 'accountId=129923', stepName: 'call ada@example.com' },
      })],
    }), opts);

    const a = await client.execute({ sql: 'SELECT * FROM alerts WHERE id=?', args: ['al_redact_pe_alert'] });
    assert.equal(a.rows.length, 1);
    assert.equal(String(a.rows[0]!.kind), 'sensitive_data');
    assert.equal(String(a.rows[0]!.severity), 'warn');
    const message = String(a.rows[0]!.message);
    assert.match(message, /2 metadata fields/);
    assert.match(message, /an email address/);
    assert.match(message, /named as a payload or a credential/);
  });

  test('never writes the caller’s key names, even when a key is itself the leak', async () => {
    // A key name is caller free text up to 64 characters, so it can be the
    // sensitive value. This is the whole reason the alert reports classes.
    await applyIngest(IngestBody.parse({
      evidence: [ev({
        id: 'pe_keyleak', workloadId: 'wl_support', operation: 'tools/call:keyleak',
        metadata: { 'victim.bob@example.com_token': 'x' },
      })],
    }), opts);

    const a = await client.execute({ sql: 'SELECT message FROM alerts WHERE id=?', args: ['al_redact_pe_keyleak'] });
    const message = String(a.rows[0]!.message);
    assert.ok(!message.includes('victim.bob@example.com_token'), 'the key is not in the alert');
    assert.deepEqual(detectSensitive(message), [], 'and the alert trips no detector of its own');

    const everything = await client.execute(`SELECT message FROM alerts`);
    const all = everything.rows.map((x) => String(x.message)).join('\n');
    assert.ok(!all.includes('bob@example.com'), 'nor anywhere else in the alerts table');
  });

  test('names the workload that carried the field, not the first one in the batch', async () => {
    await applyIngest(IngestBody.parse({
      evidence: [
        ev({ id: 'pe_clean_a', workloadId: 'wl_support', operation: 'tools/call:clean' }),
        ev({ id: 'pe_dirty_b', workloadId: 'wl_other', operation: 'tools/call:dirty', metadata: { arguments: 'x' } }),
      ],
    }), opts);

    const a = await client.execute({ sql: 'SELECT workload_id FROM alerts WHERE id=?', args: ['al_redact_pe_dirty_b'] });
    assert.equal(String(a.rows[0]!.workload_id), 'wl_other');
    const none = await client.execute({ sql: 'SELECT id FROM alerts WHERE id=?', args: ['al_redact_pe_clean_a'] });
    assert.equal(none.rows.length, 0, 'the clean row raises nothing');
  });

  test('a retried batch reports the finding once', async () => {
    const body = IngestBody.parse({
      evidence: [ev({ id: 'pe_retry', workloadId: 'wl_support', metadata: { payload: 'x' } })],
    });
    await applyIngest(body, opts);
    await applyIngest(body, opts);
    const a = await client.execute(`SELECT id FROM alerts WHERE id='al_redact_pe_retry'`);
    assert.equal(a.rows.length, 1);
  });
});

describe('approval_missing', () => {
  test('fires on a completed operation that required approval and has none', async () => {
    await applyIngest(IngestBody.parse({
      evidence: [ev({
        id: 'pe_unapproved', workloadId: 'wl_support', protocol: 'ap2', kind: 'payment',
        operation: 'payment_mandate', actor: 'procurement-agent', target: 'aws',
        outcome: 'ok', requiredApproval: true, risk: 'high', valueUsd: 475,
      })],
    }), opts);

    const a = await client.execute({ sql: 'SELECT * FROM alerts WHERE id=?', args: ['al_apprmiss_pe_unapproved'] });
    assert.equal(a.rows.length, 1);
    assert.equal(String(a.rows[0]!.kind), 'approval_missing');
    assert.equal(String(a.rows[0]!.severity), 'critical');
    assert.match(String(a.rows[0]!.message), /\$475\.00/);
  });

  test('severity follows the recorded risk', async () => {
    await applyIngest(IngestBody.parse({
      evidence: [
        ev({ id: 'pe_med', operation: 'tools/call:a', outcome: 'ok', requiredApproval: true, risk: 'medium' }),
        ev({ id: 'pe_low', operation: 'tools/call:b', outcome: 'ok', requiredApproval: true, risk: 'low' }),
      ],
    }), opts);
    const sev = async (id: string) => {
      const r = await client.execute({ sql: 'SELECT severity FROM alerts WHERE id=?', args: [id] });
      return String(r.rows[0]?.severity ?? 'none');
    };
    assert.equal(await sev('al_apprmiss_pe_med'), 'warn');
    assert.equal(await sev('al_apprmiss_pe_low'), 'info');
  });

  test('stays silent while the approval is merely pending', async () => {
    await applyIngest(IngestBody.parse({
      evidence: [ev({
        id: 'pe_pending', protocol: 'ag-ui', kind: 'approval', operation: 'approval.requested',
        outcome: 'pending', requiredApproval: true, risk: 'critical',
      })],
    }), opts);
    const a = await client.execute({ sql: 'SELECT id FROM alerts WHERE id=?', args: ['al_apprmiss_pe_pending'] });
    assert.equal(a.rows.length, 0, 'an in-flight approval is the system working, not a finding');
  });

  test('stays silent when nothing happened — error, blocked, denied', async () => {
    await applyIngest(IngestBody.parse({
      evidence: (['error', 'blocked', 'denied'] as const).map((outcome) => ev({
        id: `pe_${outcome}`, operation: `tools/call:${outcome}`,
        outcome, requiredApproval: true, risk: 'critical',
      })),
    }), opts);
    for (const outcome of ['error', 'blocked', 'denied']) {
      const a = await client.execute({ sql: 'SELECT id FROM alerts WHERE id=?', args: [`al_apprmiss_pe_${outcome}`] });
      assert.equal(a.rows.length, 0, `${outcome} authorised nothing, so nothing needed approving`);
    }
  });

  test('an approved operation is not a finding, and re-posting does not duplicate', async () => {
    const body = IngestBody.parse({
      evidence: [ev({
        id: 'pe_approved', protocol: 'ap2', kind: 'payment', operation: 'payment_mandate',
        outcome: 'approved', requiredApproval: true, approvedBy: 'user_12', risk: 'high',
      }),
      ev({
        id: 'pe_dupe', operation: 'tools/call:dupe', outcome: 'ok', requiredApproval: true, risk: 'high',
      })],
    });
    await applyIngest(body, opts);
    await applyIngest(body, opts);

    const approved = await client.execute({ sql: 'SELECT id FROM alerts WHERE id=?', args: ['al_apprmiss_pe_approved'] });
    assert.equal(approved.rows.length, 0);
    const dupe = await client.execute(`SELECT id FROM alerts WHERE id='al_apprmiss_pe_dupe'`);
    assert.equal(dupe.rows.length, 1, 'the alert id is derived from the evidence id');
  });
});

describe('the adapters produce storable evidence', () => {
  test('all six protocols survive the round trip with no payload in the database', async () => {
    const secret = 'customerEmail=person@example.com';
    const observations = [
      mcpEvidence({
        id: 'pe_rt_mcp', method: 'tools/call', name: 'search_customer',
        client: 'support-agent', server: 'crm-mcp', transport: 'http', latencyMs: 84,
        ...({ arguments: secret, result: secret } as object),
      }),
      a2aEvidence({
        id: 'pe_rt_a2a', operation: 'delegate', agent: 'support-agent', peerAgent: 'refund-agent',
        taskId: 'task_123', ...({ message: secret, parts: [secret] } as object),
      }),
      agUiEvidence({
        id: 'pe_rt_agui', eventType: 'TOOL_CALL_END', agent: 'refund-agent',
        ...({ delta: secret, content: secret } as object),
      }),
      a2uiEvidence({
        id: 'pe_rt_a2ui', operation: 'surfaceUpdate', surfaceId: 'refund_confirm',
        components: ['Card', 'Button'], componentCount: 2,
        ...({ dataModel: { note: secret }, dataModelUpdate: secret } as object),
      }),
      ucpEvidence({
        id: 'pe_rt_ucp', operation: 'checkout:complete', agent: 'shopping-agent',
        merchant: 'merchant.example', amount: 175, currency: 'USD', reference: 'co_1',
        ...({ buyer: secret, lineItems: [secret] } as object),
      }),
      ap2Evidence({
        id: 'pe_rt_ap2', operation: 'payment_mandate', agent: 'procurement-agent',
        merchant: 'aws', amount: 475, currency: 'USD', mandateRef: 'mandate_829',
        requiredApproval: true, approvedBy: 'user_12',
        ...({ signature: secret, paymentCredential: secret } as object),
      }),
    ];

    const r = await applyIngest(IngestBody.parse({
      evidence: observations.map((o) => ({ ...o, traceId: 'tr_story', workloadId: 'wl_support' })),
    }), opts);
    assert.equal(r.evidenceAccepted, 6);
    assert.deepEqual(r.evidenceRedacted, [], 'the adapters had already dropped it, so ingest found nothing to drop');

    const all = await client.execute(`SELECT * FROM protocol_evidence WHERE trace_id='tr_story'`);
    assert.equal(all.rows.length, 6);
    const serialised = JSON.stringify(all.rows);
    assert.ok(!serialised.includes('person@example.com'), 'no payload reached the database');
    assert.ok(serialised.includes('crm-mcp'), 'but the normalised observation did');
    assert.ok(serialised.includes('mandate_829'), 'and so did the safe reference');
  });
});

describe('org isolation', () => {
  test('another org cannot see, or be named by, this org’s evidence', async () => {
    await applyIngest(IngestBody.parse({
      orgId: 'org_other',
      // The body names the wrong workload and org on purpose. `orgId` comes
      // from the authorised caller, not from anything inside the evidence.
      evidence: [ev({ id: 'pe_other', workloadId: 'wl_support', traceId: 'tr_other', operation: 'tools/call:other' })],
    }), opts);

    const mine = await client.execute(`SELECT id FROM protocol_evidence WHERE org_id='org_demo' AND id='pe_other'`);
    assert.equal(mine.rows.length, 0);
    const theirs = await client.execute(`SELECT org_id FROM protocol_evidence WHERE id='pe_other'`);
    assert.equal(String(theirs.rows[0]!.org_id), 'org_other');

    const summary = await protocolSummary('org_other');
    assert.equal(summary.total, 1, 'the other org sees exactly its own one row');
  });

  test('naming another tenant’s workload id does not read back its name', async () => {
    // `workloadId` on an observation is caller input and nothing validates it
    // against the org's own workloads. The storage boundary holds — the row is
    // written under org_other — so the boundary that has to hold on the way
    // out is the join.
    const rows = await recentEvidence('org_other');
    const planted = rows.find((r) => r.id === 'pe_other');
    assert.ok(planted, 'the row is there');
    assert.equal(planted.workloadId, 'wl_support', 'still carrying the id it claimed');
    assert.equal(planted.workloadName, null, 'but org_demo’s workload name is not resolved for it');

    const ours = await recentEvidence('org_demo');
    assert.ok(
      ours.some((r) => r.workloadName === 'Support triage'),
      'while our own rows still resolve the name',
    );
  });

  test('the cross-grain trace view applies the same boundary', async () => {
    const story = await traceStory('org_other', 'tr_other');
    assert.ok(story, 'the other org can read its own trace');
    assert.equal(story.evidence[0]!.workloadName, null);
  });

  test('nor does an alert this evidence raised carry the name onto a dashboard', async () => {
    // The two evidence alerts take their workload from the sender, which is
    // why the alert list has to apply the boundary the ingest could not.
    await applyIngest(IngestBody.parse({
      orgId: 'org_other',
      evidence: [ev({
        id: 'pe_other_alert', workloadId: 'wl_support', operation: 'tools/call:peek',
        metadata: { arguments: 'x' },
      })],
    }), opts);

    const theirs = await recentAlerts('org_other');
    const raised = theirs.find((a) => a.kind === 'sensitive_data');
    assert.ok(raised, 'the alert is there');
    assert.equal(raised.workloadName, null, 'without org_demo’s workload name on it');

    const ours = await recentAlerts('org_demo');
    assert.ok(ours.some((a) => a.workloadName === 'Support triage'), 'our own alerts still name their workload');
  });
});

describe('the rollups the Protocols page reads', () => {
  test('counts events, approvals and value per protocol', async () => {
    const summary = await protocolSummary('org_demo');
    const mcp = summary.byProtocol.find((p) => p.protocol === 'mcp');
    const ap2 = summary.byProtocol.find((p) => p.protocol === 'ap2');

    assert.ok(mcp && mcp.events > 0);
    assert.ok(ap2 && ap2.events >= 3);
    assert.ok(summary.missingApprovals >= 1);
    assert.equal(summary.total, summary.byProtocol.reduce((a, p) => a + p.events, 0));
  });

  test('value acted on is counted once per unit of work, not once per protocol', async () => {
    // tr_story carries a $175 UCP checkout and a $475 AP2 mandate — two
    // protocols witnessing one trace. pe_unapproved is $475 on no trace.
    const summary = await protocolSummary('org_demo');
    assert.equal(summary.valueUsd, 475 + 475, 'the $175 and $475 on one trace count once, as the larger');
    assert.equal(summary.byProtocol.find((p) => p.protocol === 'ucp')!.valueUsd, 175);
    assert.equal(summary.byProtocol.find((p) => p.protocol === 'ap2')!.valueUsd, 475 + 475);
    assert.ok(
      summary.valueUsd <= summary.byProtocol.reduce((a, p) => a + p.valueUsd, 0),
      'the headline never exceeds the per-protocol figures it de-duplicates',
    );
  });

  test('missing approvals are counted from the evidence, not from unacknowledged alerts', async () => {
    const before = (await protocolSummary('org_demo')).missingApprovals;
    await client.execute(`UPDATE alerts SET acknowledged_at = ${Date.now()} WHERE kind='approval_missing'`);
    const after = (await protocolSummary('org_demo')).missingApprovals;
    assert.equal(after, before, 'acknowledging an alert does not make the signature appear');
  });

  test('the recent evidence table returns rows newest first', async () => {
    const rows = await recentEvidence('org_demo', 10);
    assert.ok(rows.length > 0);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1]!.ts >= rows[i]!.ts);
  });
});

describe('one trace across four grains', () => {
  test('a trace reads as model cost, protocol chain, actions and outcome', async () => {
    await applyIngest(IngestBody.parse({
      events: [{
        id: 'ev_story', traceId: 'tr_story', workloadId: 'wl_support',
        provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: 0,
        inputTokens: 1200, outputTokens: 300,
      }],
      actions: [{
        id: 'ac_story', traceId: 'tr_story', workloadId: 'wl_support',
        name: 'Issue refund', system: 'Stripe', blastRadius: 'reversible',
        valueUsd: 89.5, approvedBy: 'user_12', requiredApproval: true,
      }],
      traces: [{ traceId: 'tr_story', workloadId: 'wl_support', outcome: 'success' }],
    }), opts);

    const story = await traceStory('org_demo', 'tr_story');
    assert.ok(story);
    assert.equal(story.outcome, 'success');
    assert.ok(story.totalCostUsd > 0, 'model cost comes from events');
    assert.equal(story.models.length, 1);
    assert.equal(story.evidence.length, 6, 'and all six protocol observations come from their own table');
    assert.equal(story.actions.length, 1);
    assert.equal(story.actions[0]!.valueUsd, 89.5);
    assert.deepEqual(
      [...new Set(story.evidence.map((e) => e.protocol))].sort(),
      ['a2a', 'a2ui', 'ag-ui', 'ap2', 'mcp', 'ucp'],
    );
  });

  test('the workload page picks the trace that crosses the most protocols', async () => {
    const picked = await richestProtocolTrace('org_demo', 'wl_support');
    assert.equal(picked, 'tr_story');
  });
});
