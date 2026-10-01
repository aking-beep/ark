import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from './policy.js';

const piiProd = {
  id: 'pol_pii_prod',
  name: 'Production PII',
  when: { environment: 'production', dataClasses: { includes: ['pii'] } },
  require: { policyRefs: true, evaluations: true, humanEscalation: true },
};

describe('evaluatePolicy', () => {
  test('unmatched conditions return unknown, not pass', () => {
    const r = evaluatePolicy(piiProd, {
      id: 'a',
      name: 'A',
      environment: 'development',
      dataAccess: { dataClasses: ['pii'] },
    });
    assert.equal(r.matched, false);
    assert.equal(r.status, 'unknown');
    assert.deepEqual(r.failures, []);
  });

  test('production PII without governance fails', () => {
    const r = evaluatePolicy(piiProd, {
      id: 'a',
      name: 'A',
      environment: 'production',
      dataAccess: { dataClasses: ['pii'] },
    });
    assert.equal(r.matched, true);
    assert.equal(r.status, 'fail');
    assert.ok(r.failures.includes('policyRefs required'));
    assert.ok(r.failures.includes('evaluations required'));
    assert.ok(r.failures.includes('humanEscalation required'));
  });

  test('matching agent with required evidence passes', () => {
    const r = evaluatePolicy(piiProd, {
      id: 'a',
      name: 'A',
      environment: 'production',
      dataAccess: { dataClasses: ['pii'] },
      governance: { policyRefs: ['pol_pii_prod'], evaluationRefs: ['eval_1'], humanEscalation: true },
    });
    assert.equal(r.status, 'pass');
    assert.equal(r.failures.length, 0);
  });

  test('unapproved provider fails when the policy lists approved providers', () => {
    const r = evaluatePolicy(
      {
        id: 'pol_models',
        name: 'Approved models',
        when: { environment: 'production' },
        require: { approvedProviders: ['anthropic'], approvedModels: ['claude-haiku-4.5'] },
      },
      {
        id: 'a',
        name: 'A',
        environment: 'production',
        models: [{ provider: 'openai', modelId: 'gpt-4o' }],
      },
    );
    assert.equal(r.status, 'fail');
    assert.ok(r.failures.some((f) => f.includes('openai')));
    assert.ok(r.failures.some((f) => f.includes('gpt-4o')));
  });

  test('loggingEnabled cannot be verified from the manifest', () => {
    const r = evaluatePolicy(
      { id: 'pol_log', name: 'Logs', require: { loggingEnabled: true } },
      { id: 'a', name: 'A' },
    );
    assert.equal(r.matched, true);
    assert.equal(r.status, 'unknown');
  });

  test('financial permission condition matches only when the flag is true', () => {
    const policy = {
      id: 'pol_fin',
      name: 'Financial',
      when: { permission: { includes: ['financial'] } },
      require: { humanApproval: true },
    };
    const miss = evaluatePolicy(policy, { id: 'a', name: 'A', permissions: { read: true } });
    assert.equal(miss.matched, false);
    const hit = evaluatePolicy(policy, { id: 'a', name: 'A', permissions: { financial: true } });
    assert.equal(hit.matched, true);
    assert.equal(hit.status, 'fail');
  });
});
