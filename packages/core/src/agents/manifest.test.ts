import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AgentManifest } from './manifest.js';

describe('AgentManifest', () => {
  test('parses a bounded identity', () => {
    const parsed = AgentManifest.parse({
      id: 'support-agent',
      name: 'Support triage',
      purpose: 'Triage inbound tickets',
      owner: 'sam',
      team: 'cx',
      status: 'registered',
      environment: 'production',
      riskLevel: 'high',
    });
    assert.equal(parsed.id, 'support-agent');
    assert.equal(parsed.models.length, 0);
    assert.equal(parsed.governance, undefined);
    assert.equal(parsed.owner, 'sam');
  });

  test('defaults closed enums rather than inventing owners or policies', () => {
    const parsed = AgentManifest.parse({ id: 'a', name: 'A' });
    assert.equal(parsed.status, 'unknown');
    assert.equal(parsed.environment, 'unknown');
    assert.equal(parsed.riskLevel, 'unknown');
    assert.equal(parsed.owner, undefined);
    assert.equal(parsed.permissions, undefined);
    assert.equal(parsed.dataAccess, undefined);
  });

  test('rejects a giant purpose', () => {
    const r = AgentManifest.safeParse({ id: 'x', name: 'x', purpose: 'x'.repeat(20_000) });
    assert.equal(r.success, false);
  });

  test('rejects oversized model arrays', () => {
    const r = AgentManifest.safeParse({
      id: 'x',
      name: 'x',
      models: Array.from({ length: 33 }, (_, i) => ({ provider: 'openai', modelId: `m${i}` })),
    });
    assert.equal(r.success, false);
  });

  test('rejects unknown status values', () => {
    const r = AgentManifest.safeParse({ id: 'x', name: 'x', status: 'live' });
    assert.equal(r.success, false);
  });

  test('requires id and name', () => {
    assert.equal(AgentManifest.safeParse({ name: 'x' }).success, false);
    assert.equal(AgentManifest.safeParse({ id: 'x' }).success, false);
  });
});
