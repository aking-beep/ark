import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DDL } from './sql.js';
import { deliverAlerts } from './alerts.js';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-alert-'));
const client = createClient({ url: `file:${path.join(dir, 'test.db')}` });

before(async () => {
  for (const stmt of DDL) await client.execute(stmt);
  await client.execute({
    sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
    args: ['org_a', 'A', Date.now()],
  });
  await client.execute({
    sql: 'INSERT INTO alert_destinations (id,org_id,kind,url,created_at) VALUES (?,?,?,?,?)',
    args: ['dest_1', 'org_a', 'webhook', 'http://sink.test/hook', Date.now()],
  });
});

describe('deliverAlerts', () => {
  test('POSTs JSON and records a hit', async () => {
    const posted: unknown[] = [];
    const r = await deliverAlerts('org_a', [{
      kind: 'unapproved_action', severity: 'critical', workloadId: 'wl_x', message: 'no approver',
    }], {
      client,
      fetchFn: (async (_url, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response('ok', { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(r.attempted, 1);
    assert.equal(r.ok, 1);
    assert.equal((posted[0] as { kind: string }).kind, 'unapproved_action');
    const rows = await client.execute('SELECT ok FROM alert_deliveries');
    assert.equal(Number(rows.rows[0]?.ok), 1);
  });

  test('a hung destination times out and does not throw', async () => {
    const r = await deliverAlerts('org_a', [{
      kind: 'budget_breach', severity: 'critical', workloadId: null, message: 'over',
    }], {
      client,
      timeoutMs: 30,
      fetchFn: ((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as typeof fetch,
    });
    assert.equal(r.ok, 0);
    assert.equal(r.attempted, 1);
    const miss = await client.execute(`SELECT error FROM alert_deliveries ORDER BY ts DESC LIMIT 1`);
    assert.match(String(miss.rows[0]?.error), /timeout/);
  });
});
