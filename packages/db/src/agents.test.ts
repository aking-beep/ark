import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentManifest, runAssurance } from '@ark/core';
import { DDL } from './sql.js';
import { applyIngest } from './ingest.js';
import { IngestBody } from '@ark/core';
import {
  upsertAgent,
  getAgent,
  listAgents,
  createDiscoveryRun,
  getDiscoveryRun,
  createAssuranceRun,
  latestAssuranceForAgent,
  listAssuranceRuns,
  agentObservations,
} from './agents.js';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-agents-'));
const url = `file:${path.join(dir, 'test.db')}`;
const client = createClient({ url });

before(async () => {
  for (const stmt of DDL) await client.execute(stmt);
  await client.execute({
    sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
    args: ['org_a', 'A', Date.now()],
  });
  await client.execute({
    sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
    args: ['org_b', 'B', Date.now()],
  });
  await client.execute({
    sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: ['wl_a', 'org_a', 'A', 'bounded-agent', '{}', null, 'live', Date.now()],
  });
});

const manifest = AgentManifest.parse({
  id: 'support-agent',
  name: 'Support triage',
  purpose: 'Triage tickets',
  source: { repository: 'https://github.com/acme/bot', commitSha: 'abc', branch: 'main' },
  models: [{ provider: 'anthropic', modelId: 'claude-haiku-4.5' }],
});

describe('agent persistence', () => {
  test('upserts and lists within one org', async () => {
    const row = await upsertAgent('org_a', manifest, { status: 'registered' }, client);
    assert.equal(row.id, 'support-agent');
    assert.equal(row.orgId, 'org_a');
    const got = await getAgent('org_a', 'support-agent', client);
    assert.equal(got?.name, 'Support triage');
    const listed = await listAgents('org_a', client);
    assert.equal(listed.length, 1);
  });

  test('org isolation: org_b cannot read org_a agents or runs', async () => {
    assert.equal(await getAgent('org_b', 'support-agent', client), null);
    assert.deepEqual(await listAgents('org_b', client), []);
    const run = await createDiscoveryRun(
      'org_a',
      {
        repository: 'https://github.com/acme/bot',
        branch: 'main',
        status: 'complete',
        result: {
          repository: 'https://github.com/acme/bot',
          branch: 'main',
          candidates: [],
          models: [],
          tools: [],
          mcpServers: [],
          integrations: [],
          infrastructure: [],
          frameworks: [],
          envVarRefs: [],
          evidence: [],
          warnings: [],
          confidence: 0,
        },
      },
      client,
    );
    assert.equal(await getDiscoveryRun('org_b', run.id, client), null);
    assert.ok(await getDiscoveryRun('org_a', run.id, client));
  });

  test('assurance runs persist and latest wins', async () => {
    const report = runAssurance(manifest);
    const first = await createAssuranceRun('org_a', 'support-agent', report, client);
    const later = runAssurance({ ...manifest, owner: 'sam' });
    const second = await createAssuranceRun('org_a', 'support-agent', { ...later, timestamp: report.timestamp + 1 }, client);
    const latest = await latestAssuranceForAgent('org_a', 'support-agent', client);
    assert.equal(latest?.id, second.id);
    assert.notEqual(latest?.id, first.id);
    assert.equal(await latestAssuranceForAgent('org_b', 'support-agent', client), null);
    const listed = await listAssuranceRuns('org_a', client);
    assert.ok(listed.length >= 2);
    const other = await listAssuranceRuns('org_b', client);
    assert.equal(other.length, 0);
  });

  test('ingest stores agent_id and observations stay org-scoped', async () => {
    const body = IngestBody.parse({
      orgId: 'org_a',
      events: [{
        id: 'ev_agent_1',
        traceId: 'tr_agent_1',
        workloadId: 'wl_a',
        provider: 'anthropic',
        modelId: 'claude-haiku-4.5',
        agentId: 'support-agent',
        costUsd: 0.02,
      }],
    });
    const r = await applyIngest(body, {
      client,
      allowlist: ['anthropic'],
      turnCeiling: 25,
      traceCostCeiling: 10,
    });
    assert.equal(r.accepted, 1);
    const obs = await agentObservations('org_a', 'support-agent', 30, client);
    assert.equal(obs.calls, 1);
    assert.ok(obs.spendUsd > 0);
    const other = await agentObservations('org_b', 'support-agent', 30, client);
    assert.equal(other.calls, 0);
    const stored = await client.execute({ sql: 'SELECT agent_id FROM events WHERE id=?', args: ['ev_agent_1'] });
    assert.equal(String(stored.rows[0]?.agent_id), 'support-agent');
  });

  test('events without agentId still ingest', async () => {
    const r = await applyIngest(IngestBody.parse({
      orgId: 'org_a',
      events: [{
        id: 'ev_no_agent',
        traceId: 'tr_no_agent',
        workloadId: 'wl_a',
        provider: 'anthropic',
        modelId: 'claude-haiku-4.5',
      }],
    }), {
      client,
      allowlist: ['anthropic'],
      turnCeiling: 25,
      traceCostCeiling: 10,
    });
    assert.equal(r.accepted, 1);
    const stored = await client.execute({ sql: 'SELECT agent_id FROM events WHERE id=?', args: ['ev_no_agent'] });
    assert.equal(stored.rows[0]?.agent_id, null);
  });

  test('actions and protocol evidence store optional agent_id and count by it', async () => {
    const r = await applyIngest(IngestBody.parse({
      orgId: 'org_a',
      events: [{
        id: 'ev_join',
        traceId: 'tr_join',
        workloadId: 'wl_a',
        provider: 'anthropic',
        modelId: 'claude-haiku-4.5',
        agentId: 'support-agent',
      }],
      actions: [{
        id: 'ac_join',
        traceId: 'tr_join',
        workloadId: 'wl_a',
        name: 'refund',
        system: 'stripe',
        blastRadius: 'costly',
        agentId: 'support-agent',
      }],
      evidence: [{
        id: 'pe_join',
        traceId: 'tr_join',
        workloadId: 'wl_a',
        protocol: 'mcp',
        kind: 'tool',
        operation: 'tools/call:search',
        agentId: 'support-agent',
      }],
    }), {
      client,
      allowlist: ['anthropic'],
      turnCeiling: 25,
      traceCostCeiling: 10,
    });
    assert.equal(r.accepted, 1);
    const action = await client.execute({ sql: 'SELECT agent_id FROM actions WHERE id=?', args: ['ac_join'] });
    const ev = await client.execute({ sql: 'SELECT agent_id FROM protocol_evidence WHERE id=?', args: ['pe_join'] });
    assert.equal(String(action.rows[0]?.agent_id), 'support-agent');
    assert.equal(String(ev.rows[0]?.agent_id), 'support-agent');
    const obs = await agentObservations('org_a', 'support-agent', 30, client);
    assert.ok(obs.actions >= 1);
    assert.ok(obs.protocolEvents >= 1);
    const other = await agentObservations('org_b', 'support-agent', 30, client);
    assert.equal(other.actions, 0);
    assert.equal(other.protocolEvents, 0);
  });

  test('corrupt assurance JSON is skipped, not thrown', async () => {
    await client.execute({
      sql: `INSERT INTO assurance_runs (id, org_id, agent_id, created_at, status, report)
            VALUES (?,?,?,?,?,?)`,
      args: ['ar_bad', 'org_a', 'support-agent', Date.now() + 50_000, 'fail', '{not-json'],
    });
    const latest = await latestAssuranceForAgent('org_a', 'support-agent', client);
    assert.ok(latest);
    assert.notEqual(latest.id, 'ar_bad');
    const listed = await listAssuranceRuns('org_a', client);
    assert.ok(listed.every((r) => r.id !== 'ar_bad'));
  });
});
