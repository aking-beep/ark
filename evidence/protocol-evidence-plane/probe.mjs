#!/usr/bin/env node
/**
 * Before/after probe for the protocol-evidence-plane feature.
 *
 * Runs the same fixed set of assertions before and after the change, against a
 * throwaway SQLite file built from the repo's own DDL, so the two captures are
 * comparable line for line. Everything that does not exist yet prints ABSENT
 * rather than throwing, which is what makes the "before" run possible at all.
 *
 * Requires: npm run build:packages
 * Usage:    node evidence/protocol-evidence-plane/probe.mjs
 */
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = [];
const line = (k, v) => out.push(`${k.padEnd(46)} ${v}`);
const ABSENT = 'ABSENT';

async function tryImport(spec) {
  try {
    return await import(spec);
  } catch {
    return null;
  }
}

const core = await tryImport('@ark/core');
const db = await tryImport('@ark/db');
const protocols = await tryImport('@ark/protocols');
const sdk = await tryImport('@ark/sdk');

line('@ark/core resolves', core ? 'yes' : ABSENT);
line('@ark/db resolves', db ? 'yes' : ABSENT);
line('@ark/protocols resolves', protocols ? 'yes' : ABSENT);

/* ---------------------------------------------------------------- schema */

line('core exports EvidenceInput', core?.EvidenceInput ? 'yes' : ABSENT);
line('core exports redactEvidence', core?.redactEvidence ? 'yes' : ABSENT);
line(
  'DDL declares protocol_evidence',
  db?.DDL?.some((s) => /CREATE TABLE IF NOT EXISTS protocol_evidence/.test(s)) ? 'yes' : ABSENT,
);

const dir = mkdtempSync(path.join(tmpdir(), 'ark-probe-'));
const client = createClient({ url: `file:${path.join(dir, 'probe.db')}` });
for (const stmt of db?.DDL ?? []) await client.execute(stmt);
for (const [id, name] of [
  ['org_demo', 'Probe Co'],
  ['org_other', 'Other Co'],
]) {
  await client.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: [id, name, Date.now()] });
}
for (const [wid, oid] of [
  ['wl_probe', 'org_demo'],
  ['wl_other', 'org_other'],
]) {
  await client.execute({
    sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [wid, oid, 'Probe', 'bounded-agent', '{}', null, 'live', Date.now()],
  });
}

const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
const tableNames = tables.rows.map((r) => String(r.name));
line('tables in pushed schema', String(tableNames.length));
line('protocol_evidence table exists', tableNames.includes('protocol_evidence') ? 'yes' : ABSENT);

const opts = {
  client,
  allowlist: ['anthropic', 'openai'],
  turnCeiling: 5,
  traceCostCeiling: 0.5,
  qualityMinSamples: 20,
};

const evidenceRow = (over = {}) => ({
  id: 'pe_probe_1',
  traceId: 'tr_probe',
  workloadId: 'wl_probe',
  protocol: 'mcp',
  kind: 'tool',
  operation: 'tools/call:search_customer',
  actor: 'support-agent',
  target: 'crm-mcp',
  outcome: 'ok',
  latencyMs: 84,
  risk: 'medium',
  ...over,
});

/* ------------------------------------------------------- evidence ingest */

let parses = ABSENT;
if (core?.IngestBody) {
  parses = core.IngestBody.safeParse({ orgId: 'org_demo', evidence: [evidenceRow()] }).success ? 'yes' : 'no';
}
line('evidence-only body parses', parses);

let accepted = ABSENT;
let idempotent = ABSENT;
if (parses === 'yes' && db?.applyIngest) {
  const body = core.IngestBody.parse({ orgId: 'org_demo', evidence: [evidenceRow()] });
  const first = await db.applyIngest(body, opts);
  await db.applyIngest(body, opts);
  const rows = await client.execute(`SELECT COUNT(*) n FROM protocol_evidence WHERE id='pe_probe_1'`);
  accepted = String(first.evidenceAccepted ?? 0);
  idempotent = String(rows.rows[0].n) === '1' ? 'yes (1 row after 2 posts)' : `no (${rows.rows[0].n} rows)`;
}
line('evidence accepted by applyIngest', accepted);
line('duplicate evidence id is a no-op', idempotent);

let correlated = ABSENT;
if (accepted !== ABSENT) {
  const r = await client.execute(`SELECT trace_id, workload_id, org_id FROM protocol_evidence WHERE id='pe_probe_1'`);
  const row = r.rows[0];
  correlated = row ? `${row.trace_id}/${row.workload_id}/${row.org_id}` : 'no row';
}
line('evidence trace/workload/org', correlated);

/* ---------------------------------------------------------- redaction */

const PAYLOAD = 'person@example.com';
let mcpLeak = ABSENT;
let a2uiLeak = ABSENT;
if (protocols?.mcpEvidence) {
  const ev = protocols.mcpEvidence({
    method: 'tools/call',
    name: 'search_customer',
    server: 'crm-mcp',
    // A JavaScript caller can pass these; the type cannot stop them.
    arguments: { customerEmail: PAYLOAD, accountId: '129923' },
    result: { content: [{ type: 'text', text: PAYLOAD }] },
  });
  mcpLeak = JSON.stringify(ev).includes(PAYLOAD) ? 'LEAKS' : 'no';
}
if (protocols?.a2uiEvidence) {
  const ev = protocols.a2uiEvidence({
    operation: 'updateDataModel',
    surfaceId: 'srf_1',
    contents: { customer: { email: PAYLOAD } },
    dataModel: { email: PAYLOAD },
  });
  a2uiLeak = JSON.stringify(ev).includes(PAYLOAD) ? 'LEAKS' : 'no';
}
line('mcp adapter leaks raw args/results', mcpLeak);
line('a2ui adapter leaks application data', a2uiLeak);

let metaRejected = ABSENT;
let metaRedacted = ABSENT;
if (core?.EvidenceInput) {
  metaRejected = core.EvidenceInput.safeParse(
    evidenceRow({ id: 'pe_nested', metadata: { args: { email: PAYLOAD } } }),
  ).success
    ? 'no (accepted nested)'
    : 'yes';
}
if (core?.redactEvidence && core?.EvidenceInput) {
  const parsed = core.EvidenceInput.parse(
    evidenceRow({ id: 'pe_redact', metadata: { arguments: PAYLOAD, note: `reach ${PAYLOAD}`, toolName: 'search' } }),
  );
  const { evidence, redacted } = core.redactEvidence(parsed);
  metaRedacted = JSON.stringify(evidence).includes(PAYLOAD)
    ? 'LEAKS'
    : `yes (${redacted.slice().sort().join(',')})`;
}
line('nested metadata rejected at schema', metaRejected);
line('redactEvidence strips payload metadata', metaRedacted);

/* ------------------------------------------------------- approval_missing */

let fires = ABSENT;
let silentOnPending = ABSENT;
if (accepted !== ABSENT) {
  await db.applyIngest(
    core.IngestBody.parse({
      orgId: 'org_demo',
      evidence: [
        evidenceRow({
          id: 'pe_unapproved',
          protocol: 'ap2',
          kind: 'payment',
          operation: 'payment_mandate',
          risk: 'high',
          requiredApproval: true,
          outcome: 'ok',
        }),
        evidenceRow({
          id: 'pe_pending',
          protocol: 'ag-ui',
          kind: 'approval',
          operation: 'approval.requested',
          risk: 'high',
          requiredApproval: true,
          outcome: 'pending',
        }),
      ],
    }),
    opts,
  );
  const a = await client.execute(`SELECT id, severity FROM alerts WHERE kind='approval_missing' ORDER BY id`);
  const ids = a.rows.map((r) => String(r.id));
  fires = ids.some((i) => i.includes('pe_unapproved'))
    ? `yes (${a.rows.find((r) => String(r.id).includes('pe_unapproved')).severity})`
    : 'no';
  silentOnPending = ids.some((i) => i.includes('pe_pending')) ? 'FIRED (wrong)' : 'yes';
}
line('approval_missing fires on completed', fires);
line('approval_missing silent while pending', silentOnPending);

/* ----------------------------------------------------------- isolation */

let isolated = ABSENT;
if (accepted !== ABSENT) {
  await db.applyIngest(
    core.IngestBody.parse({
      orgId: 'org_other',
      evidence: [evidenceRow({ id: 'pe_other', traceId: 'tr_other', workloadId: 'wl_other' })],
    }),
    opts,
  );
  const mine = await client.execute(`SELECT COUNT(*) n FROM protocol_evidence WHERE org_id='org_demo'`);
  const theirs = await client.execute(`SELECT COUNT(*) n FROM protocol_evidence WHERE org_id='org_other'`);
  isolated = `org_demo=${mine.rows[0].n} org_other=${theirs.rows[0].n}`;
}
line('evidence rows per org', isolated);

/* -------------------------------------------------------------- the SDK */

let sdkEvidence = ABSENT;
if (sdk?.ArkIngest) {
  const posted = [];
  const c = new sdk.ArkIngest({
    baseUrl: 'http://control.test',
    orgId: 'org_demo',
    fetch: async (_u, init) => {
      posted.push(JSON.parse(String(init.body)));
      return new Response('{"accepted":0,"tracesClosed":0,"priced":0,"unpriced":0,"alerts":0,"circuitBreaks":[]}', {
        status: 202,
      });
    },
  });
  const t = c.trace('wl_probe', 'tr_sdk');
  if (typeof t.evidence === 'function') {
    t.evidence({ protocol: 'a2a', kind: 'delegation', operation: 'delegate', actor: 'a', target: 'b' });
    await t.close('success');
    const e = posted[0]?.evidence?.[0];
    sdkEvidence = e ? `${e.traceId}/${e.workloadId}` : 'posted nothing';
  } else {
    sdkEvidence = 'no trace.evidence()';
  }
}
line('sdk trace.evidence() correlation', sdkEvidence);

/* --------------------------------------- pre-existing behaviour, unchanged */

const base = createClient({ url: `file:${path.join(dir, 'base.db')}` });
for (const stmt of db?.DDL ?? []) await base.execute(stmt);
await base.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: ['org_demo', 'B', Date.now()] });
await base.execute({
  sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at) VALUES (?,?,?,?,?,?,?,?)`,
  args: ['wl_test', 'org_demo', 'B', 'bounded-agent', '{}', null, 'live', Date.now()],
});
const baseOpts = { ...opts, client: base };

const unknown = await db.applyIngest(
  core.IngestBody.parse({
    events: [
      {
        id: 'ev_unknown',
        traceId: 'tr_unknown',
        workloadId: 'wl_test',
        provider: 'anthropic',
        modelId: 'definitely-not-a-model',
        inputTokens: 10,
        outputTokens: 5,
      },
    ],
  }),
  baseOpts,
);
line('model event: unpriced but stored', `${unknown.accepted}/${unknown.unpriced}`);

const loop = await db.applyIngest(
  core.IngestBody.parse({
    events: Array.from({ length: 8 }, (_, t) => ({
      id: `ev_loop_${t}`,
      traceId: 'tr_loop',
      workloadId: 'wl_test',
      provider: 'anthropic',
      modelId: 'claude-haiku-4.5',
      turn: t,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    })),
  }),
  baseOpts,
);
line('model event: loop_runaway breaks', String(loop.circuitBreaks.length > 0));

const act = await db.applyIngest(
  core.IngestBody.parse({
    actions: [
      { id: 'ac_bad', traceId: 'tr_act', workloadId: 'wl_test', name: 'Delete', system: 'CRM', blastRadius: 'irreversible' },
    ],
  }),
  baseOpts,
);
const unap = await base.execute(`SELECT COUNT(*) n FROM alerts WHERE kind='unapproved_action'`);
line('action: unapproved_action fires', `${act.actionsAccepted}/${unap.rows[0].n}`);

await db.applyIngest(
  core.IngestBody.parse({
    events: [
      {
        id: 'ev_pii',
        traceId: 'tr_pii',
        workloadId: 'wl_test',
        provider: 'anthropic',
        modelId: 'claude-haiku-4.5',
        sample: 'reach me at ada@example.com',
      },
    ],
  }),
  baseOpts,
);
const pii = await base.execute(`SELECT sensitive_matches FROM events WHERE id='ev_pii'`);
const evCols = await base.execute('PRAGMA table_info(events)');
line('event: sample scanned then discarded', `${pii.rows[0].sensitive_matches} / no sample column=${!evCols.rows.some((c) => String(c.name) === 'sample')}`);

/* ----------------------------------------------------------- adapters */

for (const [name, fn, arg] of [
  ['mcp', protocols?.mcpEvidence, { method: 'tools/call', name: 'search_customer', server: 'crm-mcp', latencyMs: 84 }],
  ['a2a', protocols?.a2aEvidence, { operation: 'delegate', agent: 'support-agent', peerAgent: 'refund-agent', taskId: 'task_123' }],
  ['ag-ui', protocols?.agUiEvidence, { eventType: 'approval.requested', requiredApproval: true }],
  ['a2ui', protocols?.a2uiEvidence, { operation: 'updateComponents', surfaceId: 'srf_1', components: ['Card', 'Button'] }],
  ['ucp', protocols?.ucpEvidence, { operation: 'complete_checkout', merchant: 'merchant.example', amount: 175, currency: 'USD' }],
  ['ap2', protocols?.ap2Evidence, { operation: 'payment_mandate', agent: 'procurement-agent', merchant: 'AWS', amount: 475, currency: 'USD', approvedBy: 'user_12', mandateRef: 'mandate_829' }],
]) {
  if (!fn) {
    line(`adapter ${name}`, ABSENT);
    continue;
  }
  const e = fn(arg);
  line(
    `adapter ${name}`,
    `${e.protocol} v${e.protocolVersion} ${e.kind} ${e.operation} ${e.outcome} risk=${e.risk}`,
  );
}

console.log(out.join('\n'));
