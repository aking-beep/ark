import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { detectSensitive, redactSensitiveText, luhn } from './ingest/sensitive.js';
import { IngestBody, EventInput, sensitiveLabels, INGEST_MAX_EVENTS, EVENT_SAMPLE_MAX_CHARS } from './ingest/schema.js';
import {
  EvidenceInput,
  redactMetadata,
  redactEvidence,
  EVIDENCE_METADATA_MAX_FIELDS,
} from './ingest/evidence.js';
import { isPlausibleTimestamp, INGEST_TS_MAX_AGE_MS, INGEST_TS_MAX_FUTURE_MS } from './ingest/limits.js';
import { runAssurance } from './assurance/index.js';
import { discoverRepository } from './discovery/scan.js';
import { evaluatePolicy } from './governance/policy.js';
import { attemptsPerSuccess, costPerSuccessfulOutcome, costPerAttempt } from './economics/tokens.js';
import { byId } from './models/catalog.js';
import { weakestBasis, isUncalibrated } from './schema/provenance.js';
import { fetchCalibration } from './calibration/client.js';

const ev = (over: Record<string, unknown> = {}) => ({
  id: 'e1', traceId: 't1', workloadId: 'w1', provider: 'anthropic', modelId: 'claude-haiku-4.5', ...over,
});

describe('detectors', () => {
  test('Anthropic, OpenAI project, AWS and GitHub credentials are api_key', () => {
    for (const key of [
      'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'sk-proj-AbCd_EfGh-IjKlMnOpQrStUvWxYz0123456789',
      'AKIAIOSFODNN7EXAMPLE',
      'ASIAIOSFODNN7EXAMPLE',
      'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    ]) {
      assert.deepEqual(detectSensitive(`use ${key} here`), ['api_key'], key);
    }
  });

  test('card numbers of 12–19 digits are found only when they pass Luhn', () => {
    assert.ok(detectSensitive('4111 1111 1111 1111').includes('credit_card'));
    // A 19-digit Luhn-valid PAN.
    const pan19 = '4000123412341234123';
    assert.ok(luhn(pan19), 'fixture is Luhn-valid');
    assert.ok(detectSensitive(pan19).includes('credit_card'));
    // Same digits, broken check digit.
    assert.ok(!detectSensitive('4000123412341234124').includes('credit_card'));
  });

  test('a 13-digit epoch-ms timestamp is not a card', () => {
    assert.deepEqual(detectSensitive('1728561234567'), []);
    assert.deepEqual(detectSensitive(String(Date.now())), []);
    // Every check digit, so at least one of them passes Luhn.
    for (let d = 0; d < 10; d++) {
      const s = `172856123456${d}`;
      assert.deepEqual(detectSensitive(s), [], s);
    }
  });

  test('redactSensitiveText replaces in place and is idempotent', () => {
    const once = redactSensitiveText('mail bob@example.com card 4111 1111 1111 1111');
    assert.equal(once.text, 'mail [redacted:email] card [redacted:credit_card]');
    assert.deepEqual(once.labels, ['credit_card', 'email']);
    assert.deepEqual(redactSensitiveText(once.text), { text: once.text, labels: [] });
  });
});

describe('ingest body — tenancy (C1)', () => {
  test('orgId is optional and never defaulted', () => {
    const parsed = IngestBody.parse({ events: [ev()] });
    assert.equal(parsed.orgId, undefined);
    assert.equal(Object.hasOwn(parsed, 'orgId'), false);
    assert.equal(IngestBody.parse({ orgId: 'org_a', events: [ev()] }).orgId, 'org_a');
  });
});

describe('ingest body — numeric bounds (C2)', () => {
  test('non-finite and absurd numbers are rejected', () => {
    for (const bad of [
      { costUsd: Infinity },
      { costUsd: 1e12 },
      { inputTokens: 1e12 },
      { outputTokens: -1 },
      { latencyMs: 1e12 },
      { turn: 1e9 },
    ]) {
      assert.equal(EventInput.safeParse(ev(bad)).success, false, JSON.stringify(bad));
    }
    assert.equal(EventInput.safeParse(ev({ costUsd: 0.42, inputTokens: 200_000, latencyMs: 1200 })).success, true);
  });

  test('ts must fall within [now - 400 days, now + 1 day]', () => {
    const now = Date.now();
    assert.ok(isPlausibleTimestamp(now, now));
    assert.ok(isPlausibleTimestamp(now - INGEST_TS_MAX_AGE_MS + 1000, now));
    assert.ok(!isPlausibleTimestamp(now - INGEST_TS_MAX_AGE_MS - 1000, now));
    assert.ok(!isPlausibleTimestamp(now + INGEST_TS_MAX_FUTURE_MS + 1000, now));
    assert.ok(!isPlausibleTimestamp(Number.NaN, now));
    assert.equal(EventInput.safeParse(ev({ ts: now })).success, true);
    assert.equal(EventInput.safeParse(ev({ ts: 1 })).success, false, 'epoch seconds-ish, 1970');
    assert.equal(EventInput.safeParse(ev({ ts: now + 30 * 86_400_000 })).success, false);
    const closeLate = IngestBody.safeParse({
      traces: [{ traceId: 't', workloadId: 'w', outcome: 'success', endedAt: 7_258_118_400_000 }],
    });
    assert.equal(closeLate.success, false);
    const evidenceOld = EvidenceInput.safeParse({ id: 'p', protocol: 'mcp', kind: 'tool', operation: 'x', ts: 0 });
    assert.equal(evidenceOld.success, false);
  });

  test('evidence valueUsd and latency are bounded', () => {
    const base = { id: 'p', protocol: 'ucp', kind: 'commerce', operation: 'x' } as const;
    assert.equal(EvidenceInput.safeParse({ ...base, valueUsd: Infinity }).success, false);
    assert.equal(EvidenceInput.safeParse({ ...base, valueUsd: 1e15 }).success, false);
    assert.equal(EvidenceInput.safeParse({ ...base, valueUsd: 89.5 }).success, true);
  });
});

describe('ingest body — size caps', () => {
  test('events are capped at 500 per batch', () => {
    const many = Array.from({ length: INGEST_MAX_EVENTS + 1 }, (_, i) => ev({ id: `e${i}` }));
    assert.equal(IngestBody.safeParse({ events: many }).success, false);
    assert.equal(IngestBody.safeParse({ events: many.slice(0, INGEST_MAX_EVENTS) }).success, true);
  });

  test('sample is capped at 8 KB', () => {
    assert.equal(EventInput.safeParse(ev({ sample: 'x'.repeat(EVENT_SAMPLE_MAX_CHARS + 1) })).success, false);
    assert.equal(EventInput.safeParse(ev({ sample: 'x'.repeat(EVENT_SAMPLE_MAX_CHARS) })).success, true);
  });

  test('evidence is capped at 500 per batch', () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ id: `p${i}`, protocol: 'mcp', kind: 'tool', operation: 'x' }));
    assert.equal(IngestBody.safeParse({ evidence: rows }).success, false);
  });

  test('sensitiveMatches carries labels, not text', () => {
    assert.equal(EventInput.safeParse(ev({ sensitiveMatches: ['email'] })).success, true);
    assert.equal(EventInput.safeParse(ev({ sensitiveMatches: ['bob@example.com'] })).success, false);
  });
});

describe('sensitive labels are a union, not an override', () => {
  test('an empty client label list does not switch the server scan off', () => {
    const e = EventInput.parse(ev({ sample: 'bob@x.com 123-45-6789', sensitiveMatches: [] }));
    assert.deepEqual(sensitiveLabels(e).sort(), ['email', 'us_ssn']);
  });

  test('client labels are kept and merged once', () => {
    const e = EventInput.parse(ev({ sample: 'bob@x.com', sensitiveMatches: ['email', 'api_key'] }));
    assert.deepEqual(sensitiveLabels(e).sort(), ['api_key', 'email']);
  });
});

describe('redaction — numbers, keys, fields', () => {
  test('a card number sent as a number is dropped', () => {
    const r = redactMetadata({ x: 4111111111111111, count: 3, at: Date.now() });
    assert.deepEqual(Object.keys(r.metadata).sort(), ['at', 'count']);
    assert.deepEqual(r.classes, ['credit_card']);
  });

  test('keys that are not identifiers, or that are sensitive, are dropped', () => {
    const r = redactMetadata({
      'bob@example.com': true,
      '4111-1111-1111-1111': 1,
      ['k'.repeat(65)]: 1,
      'has space': 1,
      AKIAIOSFODNN7EXAMPLE: 1,
      transport: 'stdio',
    });
    assert.deepEqual(r.metadata, { transport: 'stdio' });
    assert.deepEqual(r.classes, ['api_key', 'invalid_key']);
  });

  test('output is always schema-valid, even past the field cap', () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const r = redactMetadata(many);
    assert.equal(Object.keys(r.metadata).length, EVIDENCE_METADATA_MAX_FIELDS);
    assert.ok(r.classes.includes('over_limit'));
    assert.equal(
      EvidenceInput.safeParse({ id: 'p', protocol: 'mcp', kind: 'tool', operation: 'x', metadata: r.metadata }).success,
      true,
    );
  });

  test('every free-text field is scanned and redacted in place', () => {
    const e = EvidenceInput.parse({
      id: 'pe_1',
      protocol: 'mcp',
      kind: 'resource',
      operation: 'resources/read:file:///home/bob@example.com/ssn-123-45-6789.txt',
      actor: 'alice@corp.com',
      target: 'srv',
      evidenceRef: 'run 4111 1111 1111 1111',
      approvedBy: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      protocolVersion: '2026-07-28',
    });
    const { evidence, fields, classes, redacted } = redactEvidence(e);
    const s = JSON.stringify(evidence);
    for (const needle of ['bob@example.com', 'alice@corp.com', '123-45-6789', '4111 1111', 'sk-ant']) {
      assert.ok(!s.includes(needle), needle);
    }
    assert.equal(evidence.target, 'srv');
    assert.equal(evidence.protocolVersion, '2026-07-28');
    assert.equal(evidence.actor, '[redacted:email]');
    assert.ok(evidence.operation.startsWith('resources/read:file:///home/[redacted:email]/'));
    assert.deepEqual(fields.sort(), ['actor', 'approvedBy', 'evidenceRef', 'operation']);
    assert.deepEqual(classes, ['api_key', 'credit_card', 'email', 'us_ssn']);
    assert.deepEqual(redacted, []);
    assert.equal(EvidenceInput.safeParse(evidence).success, true);
    // And a second pass is a no-op.
    assert.equal(redactEvidence(evidence).evidence, evidence);
  });
});

describe('assurance never throws on a valid manifest', () => {
  test('a long purpose is truncated in the detail', () => {
    const r = runAssurance({ id: 'a', name: 'n', purpose: 'x'.repeat(700) });
    const c = r.checks.find((c) => c.id === 'identity.purpose')!;
    assert.equal(c.status, 'pass');
    assert.equal(c.detail.length, 600);
  });

  test('more policy refs than a check can carry are truncated, not fatal', () => {
    const refs = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const r = runAssurance({ id: 'a', name: 'n', environment: 'production', governance: { policyRefs: refs } });
    assert.ok(r.checks.every((c) => c.evidence.length <= 16));
  });
});

describe('assurance — unknown is never pass', () => {
  test('an unrecorded environment leaves production gates unknown', () => {
    const r = runAssurance({ id: 'a', name: 'n' });
    for (const id of ['prod.evals', 'prod.policies', 'prod.approval', 'prod.escalation']) {
      assert.equal(r.checks.find((c) => c.id === id)?.status, 'unknown', id);
    }
  });

  test('production with unknown risk and unrecorded permissions is unknown for approval and escalation', () => {
    const r = runAssurance({ id: 'a', name: 'n', environment: 'production' });
    assert.equal(r.checks.find((c) => c.id === 'prod.approval')?.status, 'unknown');
    assert.equal(r.checks.find((c) => c.id === 'prod.escalation')?.status, 'unknown');
  });

  test('production, low risk, permissions recorded clean: approval and escalation pass', () => {
    const r = runAssurance({
      id: 'a', name: 'n', environment: 'production', riskLevel: 'low',
      permissions: { destructive: false, financial: false, wildcard: false },
    });
    assert.equal(r.checks.find((c) => c.id === 'prod.approval')?.status, 'pass');
    assert.equal(r.checks.find((c) => c.id === 'prod.escalation')?.status, 'pass');
  });

  test('a known non-production environment still passes the ref gates', () => {
    const r = runAssurance({ id: 'a', name: 'n', environment: 'staging' });
    assert.equal(r.checks.find((c) => c.id === 'prod.evals')?.status, 'pass');
  });
});

describe('discovery never throws on a valid snapshot', () => {
  test('forty agent definitions are truncated to the schema cap', () => {
    const content = Array.from({ length: 40 }, (_, i) => `const a${i} = { name: 'agent${i}' }`).join('\n');
    const r = discoverRepository({ repository: 'https://github.com/o/r', branch: 'main', files: [{ path: 'src/agents.ts', content }] });
    assert.equal(r.candidates.length, 32);
  });

  test('an over-long MCP server name is truncated', () => {
    const cfg = { mcpServers: { ['s'.repeat(250)]: { command: 'npx' } } };
    const r = discoverRepository({
      repository: 'https://github.com/o/r', branch: 'main', files: [{ path: 'mcp.json', content: JSON.stringify(cfg) }],
    });
    assert.equal(r.mcpServers[0]!.name.length, 200);
  });

  test('a long secret-assignment path does not overflow a warning', () => {
    const path = `${'d/'.repeat(240)}x.env`;
    const r = discoverRepository({
      repository: 'https://github.com/o/r', branch: 'main',
      files: [{ path, content: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz' }],
    });
    assert.ok(r.warnings.every((w) => w.length <= 400));
  });
});

describe('policy — unverifiable is unknown, definite failures win', () => {
  test('an unknown model id cannot pass approvedModels', () => {
    const r = evaluatePolicy(
      { id: 'p', name: 'p', require: { approvedModels: ['gpt-4o'] } },
      { id: 'a', name: 'n', models: [{ provider: 'openai', modelId: 'unknown' }] },
    );
    assert.equal(r.status, 'unknown');
  });

  test('no recorded models cannot pass approvedModels or approvedProviders', () => {
    const r = evaluatePolicy(
      { id: 'p', name: 'p', require: { approvedModels: ['gpt-4o'], approvedProviders: ['openai'] } },
      { id: 'a', name: 'n' },
    );
    assert.equal(r.status, 'unknown');
    assert.equal(r.failures.length, 2);
  });

  test('a definite failure is a fail even when another requirement is unverifiable', () => {
    const r = evaluatePolicy(
      { id: 'p', name: 'p', require: { policyRefs: true, loggingEnabled: true } },
      { id: 'a', name: 'n' },
    );
    assert.equal(r.status, 'fail');
    assert.ok(r.failures.includes('policyRefs required'));
  });

  test('approved models that are all known still pass', () => {
    const r = evaluatePolicy(
      { id: 'p', name: 'p', require: { approvedModels: ['gpt-4o'], approvedProviders: ['openai'] } },
      { id: 'a', name: 'n', models: [{ provider: 'openai', modelId: 'gpt-4o' }] },
    );
    assert.equal(r.status, 'pass');
  });
});

describe('cost per successful outcome counts the failed attempt', () => {
  test('with no retries it is the geometric 1/(1-f)', () => {
    assert.ok(Math.abs(attemptsPerSuccess(0.5, 0) - 2) < 1e-12);
    assert.ok(Math.abs(attemptsPerSuccess(0.2) - 1.25) < 1e-12);
  });

  test('each failure costs the failed attempt plus its retries', () => {
    // f=0.5: one failure per success on average, costing 1 + 2 attempts.
    assert.ok(Math.abs(attemptsPerSuccess(0.5, 2) - 4) < 1e-12);
  });

  test('failure rate is clamped to 0.95 so the cost stays finite', () => {
    assert.ok(Number.isFinite(attemptsPerSuccess(1, 0)));
    assert.equal(attemptsPerSuccess(1, 0), attemptsPerSuccess(0.95, 0));
    assert.equal(attemptsPerSuccess(-1, 3), 1);
  });

  test('costPerSuccessfulOutcome applies it', () => {
    const m = byId('claude-sonnet-5')!;
    const shape = { inputTokens: 1000, outputTokens: 300, failureRate: 0.5, retriesPerFailure: 2 };
    assert.ok(Math.abs(costPerSuccessfulOutcome(m, shape) - 4 * costPerAttempt(m, shape)) < 1e-12);
  });
});

describe('provenance of nothing', () => {
  test('weakestBasis([]) is heuristic, agreeing with isUncalibrated([])', () => {
    assert.equal(weakestBasis([]), 'heuristic');
    assert.equal(isUncalibrated([]), true);
  });
});

describe('calibration client', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('does not send an org query parameter — the token decides', async () => {
    let seen = '';
    globalThis.fetch = (async (url: string | URL) => {
      seen = String(url);
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    await fetchCalibration({ baseUrl: 'http://control.test', orgId: 'org_other', days: 7, token: 't' });
    const u = new URL(seen);
    assert.equal(u.searchParams.has('org'), false);
    assert.equal(u.searchParams.get('days'), '7');
  });
});
