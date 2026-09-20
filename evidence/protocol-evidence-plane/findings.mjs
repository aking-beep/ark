#!/usr/bin/env node
/**
 * Round-1 findings, re-measured after the fixes.
 *
 * This is deliberately *not* part of `probe.mjs`. That script's value is that
 * the same assertions ran before the first line of feature code and again at
 * the tip, so its two captures are comparable line for line; adding
 * assertions to it now would produce an after-state with no before-state.
 *
 * The before-state for what follows is `REVIEW.md`, which records the exact
 * inputs the reviewer used and what the code did with them. This script feeds
 * the same inputs to the fixed code and prints what it does now.
 *
 * Requires: npm run build:packages
 * Usage:    node evidence/protocol-evidence-plane/findings.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-findings-'));
// queries.ts opens one lazy client against this URL. Set it before the import
// so the reads below see what applyIngest writes.
process.env.ARK_DATABASE_URL = `file:${path.join(dir, 'findings.db')}`;

const { createClient } = await import('@libsql/client');
const core = await import('@ark/core');
const db = await import('@ark/db');
const sdk = await import('@ark/sdk');
const protocols = await import('@ark/protocols');

const line = (k, v) => console.log(`${k.padEnd(50)} ${v}`);
const client = createClient({ url: process.env.ARK_DATABASE_URL });
for (const stmt of db.DDL) await client.execute(stmt);

for (const [id, name] of [['org_demo', 'Demo Co'], ['org_other', 'Other Co']]) {
  await client.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: [id, name, Date.now()] });
}
await client.execute({
  sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
  args: ['wl_secret', 'org_demo', 'Project Redacted - M&A due diligence', 'bounded-agent', '{}', null, 'live', Date.now()],
});

const opts = { client, allowlist: ['anthropic'], turnCeiling: 25, traceCostCeiling: 1, qualityMinSamples: 20 };
const ev = (over) => ({ id: 'pe_x', protocol: 'mcp', kind: 'tool', operation: 'tools/call:noop', ...over });

/* --- finding 1: the redaction alert persisted caller-supplied key names --- */
// Reviewer's input, verbatim. Before: alerts.message contained the key, and
// therefore the email address inside it.
const LEAKY_KEY = 'victim.bob@example.com_token';
await db.applyIngest(
  core.IngestBody.parse({
    orgId: 'org_demo',
    evidence: [ev({ id: 'pe_f1', workloadId: 'wl_secret', operation: 'tools/call:leaky', metadata: { [LEAKY_KEY]: 'x' } })],
  }),
  opts,
);
const f1 = await client.execute(`SELECT message FROM alerts WHERE kind='sensitive_data'`);
const f1msg = f1.rows.map((r) => String(r.message)).join('\n');
line('alert raised at all', f1.rows.length ? 'yes' : 'NO (regression)');
line('alert contains the caller key', f1msg.includes(LEAKY_KEY) ? 'YES (leak)' : 'no');
line('alert trips a detector of its own', core.detectSensitive(f1msg).join(',') || 'no');
line('alert names the class instead', /named as a payload or a credential/.test(f1msg) ? 'yes' : 'NO');

// The key does go back to the sender, which is not a place anything is stored.
const f1r = await db.applyIngest(
  core.IngestBody.parse({
    orgId: 'org_demo',
    evidence: [ev({ id: 'pe_f1b', workloadId: 'wl_secret', metadata: { [LEAKY_KEY]: 'x' } })],
  }),
  opts,
);
line('ingest response still names the key', f1r.evidenceRedacted.includes(LEAKY_KEY) ? 'yes' : 'no');

// Finding 4: attribution. The dirty row is second and carries its own workload.
await db.applyIngest(
  core.IngestBody.parse({
    orgId: 'org_demo',
    evidence: [
      ev({ id: 'pe_f4a', workloadId: 'wl_secret', operation: 'tools/call:clean' }),
      ev({ id: 'pe_f4b', workloadId: 'wl_dirty', operation: 'tools/call:dirty', metadata: { arguments: 'x' } }),
    ],
  }),
  opts,
);
const f4 = await client.execute(`SELECT workload_id FROM alerts WHERE id='al_redact_pe_f4b'`);
line('redaction alert names the offending workload', f4.rows.length ? String(f4.rows[0].workload_id) : 'ABSENT');

/* --- finding 2: org-unscoped join leaked another tenant's workload name --- */
// org_other posts evidence naming org_demo's workload id. Nothing validates
// that id, so the boundary has to hold on the read.
await db.applyIngest(
  core.IngestBody.parse({
    orgId: 'org_other',
    evidence: [ev({ id: 'pe_f2', traceId: 'tr_f2', workloadId: 'wl_secret', operation: 'tools/call:peek' })],
  }),
  opts,
);
const theirs = (await db.recentEvidence('org_other')).find((r) => r.id === 'pe_f2');
line('cross-org row is stored under the caller org', theirs ? 'yes' : 'NO');
line('cross-org row still claims the id', String(theirs?.workloadId));
line('cross-org read resolves the name', theirs?.workloadName === null ? 'no' : `YES (${theirs?.workloadName})`);
const story = await db.traceStory('org_other', 'tr_f2');
line('same in the cross-grain trace view', story?.evidence[0]?.workloadName === null ? 'no' : 'YES (leak)');
const ours = await db.recentEvidence('org_demo');
line('own rows still resolve their name', ours.some((r) => r.workloadName === 'Project Redacted - M&A due diligence') ? 'yes' : 'NO');

/* --- finding 3: the denylist only caught payload words at the end of a key --- */
const NAMES = [
  'argsJson', 'toolInput', 'userText', 'msg', 'requestBlob', 'resultData',
  'note', 'memo', 'detail', 'freeform', 'comment', 'reason', 'description',
  'summary', 'userMessage', 'promptText',
];
const survivors = NAMES.filter((k) => core.redactMetadata({ [k]: 'x' }).redacted.length === 0);
line('payload-ish names the denylist misses', `${survivors.length}/${NAMES.length}${survivors.length ? ` (${survivors.join(',')})` : ''}`);
const honest = {
  method: 'tools/call', transport: 'streamable-http', errorCode: -32602, errorKind: 'timeout',
  taskState: 'working', contextId: 'ctx_1', artifactCount: 2, catalogId: 'basic',
  componentCount: 4, policy: 'allowed', threadId: 'th_1', stepName: 'verify',
  toolCallName: 'search', timeToApprovalMs: 4200, mandateType: 'PaymentMandate',
  presence: 'human_present', status: 'completed', amount: 89.5, capability: 'checkout',
};
line('adapter metadata still survives the denylist', `${Object.keys(core.redactMetadata(honest).metadata).length}/${Object.keys(honest).length}`);

/* --- finding 5: evidence() let an observation re-point itself --- */
const posted = [];
const client2 = new sdk.ArkIngest({
  baseUrl: 'http://control.test',
  fetch: async (_u, init) => {
    posted.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ accepted: 0, tracesClosed: 0, evidenceAccepted: 1, priced: 0, unpriced: 0, alerts: 0, circuitBreaks: [] }), { status: 202 });
  },
});
const t = client2.trace('wl_real', 'tr_real');
t.evidence({ traceId: 'tr_somewhere_else', protocol: 'a2a', kind: 'delegation', operation: 'message/send' });
await t.flush();
line('sdk evidence trace id', posted[0].evidence[0].traceId);

/* --- finding 6: A2UI stored whatever it was handed as a component name --- */
const a2ui = protocols.a2uiEvidence({
  operation: 'updateComponents',
  agent: 'refund-agent',
  surfaceId: 'srf_1',
  components: ['Card', 'MyOrgChart', 'bob@example.com', '4111 1111 1111 1111', 'Please confirm your address'],
});
line('a2ui componentTypes', String(a2ui.metadata.componentTypes));
line('a2ui rejected, counted not stored', String(a2ui.metadata.componentsRejected));
line('a2ui serialisation carries a form value', JSON.stringify(a2ui).includes('@example.com') ? 'YES (leak)' : 'no');

/* --- finding 8: one query per protocol for the value figure --- */
let queries = 0;
const inner = db.raw();
const originalExecute = inner.execute.bind(inner);
inner.execute = (...a) => { queries += 1; return originalExecute(...a); };
await db.protocolSummary('org_demo');
inner.execute = originalExecute;
line('queries behind the Protocols page rollup', String(queries));
