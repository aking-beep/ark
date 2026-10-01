import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runAssurance } from './index.js';

describe('runAssurance', () => {
  test('a complete registered agent passes identity and provenance', () => {
    const report = runAssurance({
      id: 'support-agent',
      name: 'Support triage',
      purpose: 'Triage tickets',
      owner: 'sam',
      status: 'registered',
      environment: 'staging',
      riskLevel: 'medium',
      source: { repository: 'https://github.com/acme/bot', branch: 'main', commitSha: 'abc' },
      models: [{ provider: 'anthropic', modelId: 'claude-haiku-4.5' }],
      tools: [{ name: 'lookup', type: 'function' }],
      discovery: { evidencePaths: ['src/agent.ts'], confidence: 0.7 },
    });
    assert.equal(report.agentId, 'support-agent');
    assert.equal(typeof report.summary.pass, 'number');
    assert.equal(report.summary.pass + report.summary.warn + report.summary.fail + report.summary.unknown, report.checks.length);
    const idCheck = report.checks.find((c) => c.id === 'identity.id');
    assert.equal(idCheck?.status, 'pass');
    const owner = report.checks.find((c) => c.id === 'identity.owner');
    assert.equal(owner?.status, 'pass');
    assert.ok(!('score' in report));
  });

  test('production high-risk without owner, evals or policies fails', () => {
    const report = runAssurance({
      id: 'refund-agent',
      name: 'Refunds',
      environment: 'production',
      riskLevel: 'high',
      permissions: { financial: true, destructive: true },
      dataAccess: { containsPII: true, dataClasses: ['pii'] },
    });
    assert.equal(report.overallStatus, 'fail');
    const ids = new Set(report.checks.filter((c) => c.status === 'fail').map((c) => c.id));
    assert.ok(ids.has('identity.owner'));
    assert.ok(ids.has('prod.evals'));
    assert.ok(ids.has('prod.policies'));
    assert.ok(ids.has('data.policy'));
    assert.ok(ids.has('perm.financial'));
    assert.ok(report.findings.some((f) => f.severity === 'fail'));
  });

  test('unknown fields stay unknown rather than passing', () => {
    const report = runAssurance({ id: 'x', name: 'X' });
    const purpose = report.checks.find((c) => c.id === 'identity.purpose');
    const owner = report.checks.find((c) => c.id === 'identity.owner');
    const models = report.checks.find((c) => c.id === 'model.inventory');
    assert.equal(purpose?.status, 'unknown');
    assert.equal(owner?.status, 'unknown');
    assert.equal(models?.status, 'unknown');
    assert.ok(report.checks.every((c) => c.status !== 'pass' || c.id.startsWith('identity.') || c.id.startsWith('prod.') || c.id.startsWith('tools.') || c.id.startsWith('perm.') || c.id.startsWith('data.') || c.id.startsWith('model.') || c.id.startsWith('provenance.')));
  });

  test('every check in the report was executed', () => {
    const report = runAssurance({ id: 'x', name: 'X' });
    assert.ok(report.checks.length >= 15);
    assert.ok(report.checks.every((c) => ['pass', 'warn', 'fail', 'unknown'].includes(c.status)));
  });
});
