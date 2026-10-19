import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import type { ActionReceipt } from '@ark/core';
import { DDL, MIGRATIONS, pushSchema } from './sql.js';
import { LibsqlActionReceiptStore, openActionReceiptStore, ACTION_RECEIPTS_DDL, ACTION_RECEIPTS_MIGRATIONS } from './action-receipts.js';

function tempUrl(name: string): string {
  return `file:${path.join(mkdtempSync(path.join(tmpdir(), 'ark-receipts-')), name)}`;
}

function receipt(over: Partial<ActionReceipt> = {}): ActionReceipt {
  return {
    orgId: 'org_a',
    id: 'dec_1',
    traceId: null,
    agentId: 'agent_1',
    principal: 'user_1',
    tool: 'payments',
    action: 'refund',
    resourceType: 'order',
    resourceId: 'ord_1',
    policyId: 'pol_1',
    policyVersion: 1,
    decision: 'allow',
    reasonCode: 'rule_matched',
    requestDigest: 'a'.repeat(64),
    executionStatus: 'not_attempted',
    idempotencyKeyHash: 'k'.repeat(64),
    senderReportedApproval: false,
    amountMinor: 7_500,
    currency: 'USD',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...over,
  };
}

describe('action_receipts migrations', () => {
  const ids = ['0008_action_receipts', '0009_action_receipts_idempotency_idx', '0010_action_receipts_created_idx'];
  const recorded = async (client: ReturnType<typeof createClient>) =>
    (await client.execute(`SELECT id, applied_at FROM schema_migrations WHERE id LIKE '%action_receipts%' ORDER BY id`)).rows
      .map((r) => [String(r.id), Number(r.applied_at)]);

  test('are tracked migrations 0008-0010, not plain DDL', () => {
    assert.deepEqual(ACTION_RECEIPTS_MIGRATIONS.map((m) => m.id), ids);
    assert.ok(!DDL.some((s) => /action_receipts/.test(s)));
    assert.deepEqual(MIGRATIONS.slice(-3).map((m) => m.id), ids, 'appended after 0007');
    for (const m of ACTION_RECEIPTS_MIGRATIONS) assert.match(m.sql, /^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS /);
  });

  test('a fresh push records 0008-0010 and creates the table with an (org_id, id) key; a second push is a no-op', async () => {
    const client = createClient({ url: tempUrl('push.db') });
    await pushSchema(client);
    const first = await recorded(client);
    assert.deepEqual(first.map(([id]) => id), ids);
    const info = await client.execute(`PRAGMA table_info(action_receipts)`);
    const pk = info.rows.filter((r) => Number(r.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((r) => String(r.name));
    assert.deepEqual(pk, ['org_id', 'id']);
    // No column that could carry raw arguments, a prompt or the raw key.
    const cols = info.rows.map((r) => String(r.name)).sort();
    assert.deepEqual(cols, [
      'action', 'agent_id', 'amount_minor', 'created_at', 'currency', 'decision', 'execution_status', 'id',
      'idempotency_key_hash', 'org_id', 'policy_id', 'policy_version', 'principal', 'reason_code',
      'request_digest', 'resource_id', 'resource_type', 'sender_reported_approval', 'tool', 'trace_id', 'updated_at',
    ]);
    const indexes = (await client.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='action_receipts' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r) => String(r.name));
    assert.deepEqual(indexes, ['action_receipts_created_idx', 'action_receipts_idempotency_idx']);
    await pushSchema(client);
    assert.deepEqual(await recorded(client), first);
    client.close();
  });

  test('a database that already has the table (the pre-migration build) upgrades without error and keeps its rows', async () => {
    const client = createClient({ url: tempUrl('upgrade.db') });
    for (const stmt of ACTION_RECEIPTS_DDL) await client.execute(stmt);
    await new LibsqlActionReceiptStore(client).claim(receipt());
    await pushSchema(client);
    assert.deepEqual((await recorded(client)).map(([id]) => id), ids);
    assert.equal((await new LibsqlActionReceiptStore(client).get('org_a', 'dec_1'))?.executionStatus, 'attempted');
    client.close();
  });

  test('CHECKs refuse an executed receipt for a non-allow decision or with no key', async () => {
    const client = createClient({ url: tempUrl('check.db') });
    for (const stmt of ACTION_RECEIPTS_DDL) await client.execute(stmt);
    const store = new LibsqlActionReceiptStore(client);
    await assert.rejects(store.claim(receipt({ decision: 'deny' })), /CHECK constraint/);
    await assert.rejects(store.claim(receipt({ decision: 'require_approval', id: 'dec_2' })), /CHECK constraint/);
    await assert.rejects(store.claim(receipt({ idempotencyKeyHash: null })), /requires an idempotency key/);
    assert.equal(await store.get('org_a', 'dec_1'), null);
    client.close();
  });
});

describe('LibsqlActionReceiptStore', () => {
  test('record stores not_attempted and refuses a duplicate (org_id, id)', async () => {
    const { store, close } = await openActionReceiptStore(tempUrl('record.db'));
    assert.equal(await store.record(receipt({ executionStatus: 'completed' })), true);
    assert.equal((await store.get('org_a', 'dec_1'))?.executionStatus, 'not_attempted');
    assert.equal(await store.record(receipt()), false);
    // A not_attempted receipt does not own its key.
    assert.equal(await store.findClaim('org_a', 'k'.repeat(64)), null);
    close();
  });

  test('round-trips every field', async () => {
    const { store, close } = await openActionReceiptStore(tempUrl('roundtrip.db'));
    const r = receipt({ traceId: 'tr_1', senderReportedApproval: true, principal: null });
    assert.deepEqual(await store.claim(r), { claimed: true });
    assert.deepEqual(await store.get('org_a', 'dec_1'), { ...r, executionStatus: 'attempted' });
    close();
  });

  test('claim: one key, one owner; a second claim gets the owner back', async () => {
    const { store, close } = await openActionReceiptStore(tempUrl('claim.db'));
    assert.deepEqual(await store.claim(receipt()), { claimed: true });
    const second = await store.claim(receipt({ id: 'dec_2' }));
    assert.equal(second.claimed, false);
    assert.equal(second.claimed === false && second.existing?.id, 'dec_1');
    assert.equal(await store.get('org_a', 'dec_2'), null);
    close();
  });

  test('claim colliding on (org_id, id) only returns existing: null', async () => {
    const { store, close } = await openActionReceiptStore(tempUrl('pk.db'));
    await store.record(receipt());
    assert.deepEqual(await store.claim(receipt({ idempotencyKeyHash: 'z'.repeat(64) })), { claimed: false, existing: null });
    close();
  });

  test('keys and ids are org-scoped', async () => {
    const { store, close } = await openActionReceiptStore(tempUrl('orgs.db'));
    assert.deepEqual(await store.claim(receipt()), { claimed: true });
    assert.deepEqual(await store.claim(receipt({ orgId: 'org_b' })), { claimed: true });
    assert.equal((await store.findClaim('org_b', 'k'.repeat(64)))?.orgId, 'org_b');
    assert.equal(await store.get('org_c', 'dec_1'), null);
    close();
  });

  test('finish moves attempted to a final status once, and never touches not_attempted', async () => {
    const { store, close } = await openActionReceiptStore(tempUrl('finish.db'));
    await store.claim(receipt());
    await store.finish('org_a', 'dec_1', 'outcome_unknown', 2_000);
    await store.finish('org_a', 'dec_1', 'completed', 3_000);
    const r = await store.get('org_a', 'dec_1');
    assert.equal(r?.executionStatus, 'outcome_unknown');
    assert.equal(r?.updatedAt, 2_000);
    await store.record(receipt({ id: 'dec_2' }));
    await store.finish('org_a', 'dec_2', 'completed', 4_000);
    assert.equal((await store.get('org_a', 'dec_2'))?.executionStatus, 'not_attempted');
    close();
  });

  test('race: 20 concurrent claims for one key over two connections, exactly one lands', async () => {
    const url = tempUrl('race.db');
    const a = await openActionReceiptStore(url);
    const b = await openActionReceiptStore(url);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? a.store : b.store).claim(receipt({ id: `dec_${i}` }))),
    );
    assert.deepEqual(results.filter((r) => r.status === 'rejected'), []);
    const claimed = results.filter((r) => r.status === 'fulfilled' && r.value.claimed).length;
    assert.equal(claimed, 1);
    const rows = await a.store.list('org_a');
    assert.equal(rows.filter((r) => r.executionStatus === 'attempted').length, 1);
    a.close();
    b.close();
  });
});
