import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EvidenceInput,
  redactEvidence,
  EVIDENCE_METADATA_MAX_FIELDS,
  EVIDENCE_METADATA_MAX_VALUE_CHARS,
} from './evidence.js';
import { IngestBody } from './schema.js';

const base = {
  id: 'pe_1',
  traceId: 'tr_1',
  workloadId: 'wl_support_triage',
  protocol: 'mcp' as const,
  kind: 'tool' as const,
  operation: 'tools/call:search_customer',
  actor: 'support-agent',
  target: 'crm-mcp',
  outcome: 'ok' as const,
  latencyMs: 84,
};

describe('EvidenceInput', () => {
  test('parses the minimum an adapter can produce, and defaults the governance fields', () => {
    const e = EvidenceInput.parse({ id: 'pe_min', protocol: 'a2a', kind: 'delegation', operation: 'delegate' });
    assert.equal(e.outcome, 'ok');
    assert.equal(e.risk, 'low');
    assert.equal(e.requiredApproval, false);
    assert.deepEqual(e.metadata, {});
  });

  test('rejects a protocol it does not know', () => {
    assert.equal(EvidenceInput.safeParse({ ...base, protocol: 'grpc' }).success, false);
  });

  test('rejects nested metadata — a payload cannot arrive as a metadata value', () => {
    assert.equal(
      EvidenceInput.safeParse({ ...base, metadata: { arguments: { customerEmail: 'a@b.example' } } }).success,
      false,
    );
    assert.equal(EvidenceInput.safeParse({ ...base, metadata: { messages: ['hello'] } }).success, false);
    assert.equal(EvidenceInput.safeParse({ ...base, metadata: { note: null } }).success, false);
  });

  test('accepts scalars, and caps both the field count and the value length', () => {
    assert.equal(
      EvidenceInput.safeParse({ ...base, metadata: { transport: 'stdio', retries: 2, cached: true } }).success,
      true,
    );
    const tooMany = Object.fromEntries(
      Array.from({ length: EVIDENCE_METADATA_MAX_FIELDS + 1 }, (_, i) => [`k${i}`, i]),
    );
    assert.equal(EvidenceInput.safeParse({ ...base, metadata: tooMany }).success, false);
    assert.equal(
      EvidenceInput.safeParse({ ...base, metadata: { note: 'x'.repeat(EVIDENCE_METADATA_MAX_VALUE_CHARS + 1) } })
        .success,
      false,
    );
  });

  test('approvedBy is nullable, because the missing state is the one worth detecting', () => {
    const e = EvidenceInput.parse({ ...base, requiredApproval: true, approvedBy: null });
    assert.equal(e.approvedBy, null);
    assert.equal(e.requiredApproval, true);
  });
});

describe('redactEvidence', () => {
  test('drops metadata whose key names a payload, including compound keys', () => {
    const e = EvidenceInput.parse({
      ...base,
      metadata: { arguments: 'customerEmail=x', tool_args: 'y', mandateSignature: 'z', transport: 'stdio' },
    });
    const { evidence, redacted } = redactEvidence(e);
    assert.deepEqual(evidence.metadata, { transport: 'stdio' });
    assert.deepEqual(redacted.sort(), ['arguments', 'mandateSignature', 'tool_args']);
  });

  test('keeps honest metadata whose name merely ends in a payload word', () => {
    const e = EvidenceInput.parse({ ...base, metadata: { componentCount: 4, taskState: 'working' } });
    const { evidence, redacted } = redactEvidence(e);
    assert.deepEqual(evidence.metadata, { componentCount: 4, taskState: 'working' });
    assert.deepEqual(redacted, []);
  });

  test('drops metadata whose value is sensitive under an innocent key', () => {
    const e = EvidenceInput.parse({ ...base, metadata: { note: 'ping ada@example.com', tool: 'search' } });
    const { evidence, redacted } = redactEvidence(e);
    assert.deepEqual(evidence.metadata, { tool: 'search' });
    assert.deepEqual(redacted, ['note']);
  });

  test('reports the key it removed and never the value', () => {
    const e = EvidenceInput.parse({ ...base, metadata: { arguments: 'ada@example.com' } });
    const { redacted } = redactEvidence(e);
    assert.deepEqual(redacted, ['arguments']);
    assert.ok(!redacted.some((r) => r.includes('@')));
  });

  test('is a no-op on already-clean evidence, and returns the same object', () => {
    const e = EvidenceInput.parse({ ...base, metadata: { transport: 'stdio' } });
    const { evidence, redacted } = redactEvidence(e);
    assert.equal(redacted.length, 0);
    assert.equal(evidence, e);
  });

  test('running twice changes nothing the second time', () => {
    const e = EvidenceInput.parse({ ...base, metadata: { arguments: 'x', transport: 'stdio' } });
    const once = redactEvidence(e);
    const twice = redactEvidence(once.evidence);
    assert.deepEqual(twice.evidence.metadata, once.evidence.metadata);
    assert.equal(twice.redacted.length, 0);
  });
});

describe('IngestBody with evidence', () => {
  test('an evidence-only batch parses', () => {
    const parsed = IngestBody.safeParse({ orgId: 'org_demo', evidence: [base] });
    assert.equal(parsed.success, true);
  });

  test('a body with none of the five keys still does not parse', () => {
    assert.equal(IngestBody.safeParse({ orgId: 'org_demo' }).success, false);
    assert.equal(IngestBody.safeParse({ orgId: 'org_demo', evidence: [] }).success, false);
  });

  test('evidence carries no org of its own — the token decides tenancy', () => {
    const parsed = IngestBody.parse({ orgId: 'org_demo', evidence: [{ ...base, orgId: 'org_attacker' }] });
    assert.equal(Object.hasOwn(parsed.evidence[0]!, 'orgId'), false);
  });
});
