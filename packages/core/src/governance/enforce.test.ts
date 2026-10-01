import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AGENT_POLICIES, enforceAgentPolicies } from './enforce.js';

describe('enforceAgentPolicies', () => {
  test('production PII without governance is denied', () => {
    const v = enforceAgentPolicies({
      id: 'support-agent',
      name: 'Support',
      environment: 'production',
      dataAccess: { dataClasses: ['pii'] },
    });
    assert.equal(v.allowed, false);
    assert.ok(v.evaluations.some((e) => e.policyId === 'pol_production_pii' && e.status === 'fail'));
  });

  test('the same agent with required refs is allowed', () => {
    const v = enforceAgentPolicies({
      id: 'support-agent',
      name: 'Support',
      environment: 'production',
      dataAccess: { dataClasses: ['pii'] },
      governance: {
        policyRefs: ['pol_production_pii'],
        evaluationRefs: ['eval_1'],
        humanEscalation: true,
      },
    });
    assert.equal(v.allowed, true);
    const pii = v.evaluations.find((e) => e.policyId === 'pol_production_pii');
    assert.equal(pii?.status, 'pass');
  });

  test('development agents do not match production policies (unknown, not fail)', () => {
    const v = enforceAgentPolicies({
      id: 'dev-bot',
      name: 'Dev',
      environment: 'development',
      dataAccess: { dataClasses: ['pii'] },
    });
    assert.equal(v.allowed, true);
    assert.ok(v.evaluations.every((e) => e.status !== 'fail'));
  });

  test('omitting policies uses DEFAULT_AGENT_POLICIES', () => {
    assert.ok(DEFAULT_AGENT_POLICIES.length >= 4);
    const v = enforceAgentPolicies({ id: 'a', name: 'A' });
    assert.equal(v.evaluations.length, DEFAULT_AGENT_POLICIES.length);
    assert.equal(v.allowed, true);
  });
});
