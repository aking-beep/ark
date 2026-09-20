import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EvidenceInput,
  redactEvidence,
  redactMetadata,
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

  test('keeps the metadata every adapter actually emits', () => {
    // The guard on widening the denylist. If a rule below starts catching one
    // of these, the adapters silently stop recording it.
    const honest = {
      method: 'tools/call', transport: 'streamable-http', errorCode: -32602, errorKind: 'timeout',
      methodKnown: true, taskState: 'working', contextId: 'ctx_1', protocolBinding: 'jsonrpc',
      artifactCount: 2, operationKnown: true, catalogId: 'basic', componentTypes: 'Card,Button',
      componentCount: 4, policy: 'allowed', operationSource: 'ag-ui', threadId: 'th_1',
      stepName: 'verify', toolCallName: 'search', subagentRunId: 'run_1', timeToApprovalMs: 4200,
      mandateType: 'PaymentMandate', presence: 'human_present', status: 'completed',
      amount: 89.5, capability: 'checkout',
    };
    const { evidence, redacted } = redactEvidence(EvidenceInput.parse({ ...base, metadata: honest }));
    assert.deepEqual(redacted, []);
    assert.equal(Object.keys(evidence.metadata).length, Object.keys(honest).length);
  });

  test('a payload word anywhere in the key is still a payload word', () => {
    // Measured gap: a suffix-only rule caught `toolArgs` and missed `argsJson`.
    const names = [
      'argsJson', 'toolInput', 'userText', 'msg', 'requestBlob', 'resultData',
      'promptText', 'userMessage', 'note', 'memo', 'detail', 'freeform',
      'comment', 'reason', 'description', 'summary', 'mandate_signature',
      'checkoutJwt', 'my_api_key_ref', 'sdJwtDisclosures',
    ];
    for (const key of names) {
      const { redacted } = redactMetadata({ [key]: 'x' });
      assert.deepEqual(redacted, [key], `${key} should have been redacted`);
    }
  });

  test('drops metadata whose value is sensitive under an innocent key', () => {
    // `stepName` is on the adapters' own allowlist, so nothing about the key
    // is suspicious. The value is what trips the detector.
    const e = EvidenceInput.parse({ ...base, metadata: { stepName: 'ping ada@example.com', tool: 'search' } });
    const { evidence, redacted } = redactEvidence(e);
    assert.deepEqual(evidence.metadata, { tool: 'search' });
    assert.deepEqual(redacted, ['stepName']);
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

describe('the class vocabulary — what is safe to keep', () => {
  // A key name is caller text and can itself be the sensitive value. Anything
  // that outlives the request reports the class instead, so the vocabulary has
  // to be closed.
  const VOCABULARY = ['payload_name', 'non_scalar', 'email', 'us_ssn', 'credit_card', 'us_phone', 'api_key', 'iban'];

  test('says why, not which, for each of the three reasons', () => {
    const e = EvidenceInput.parse({
      ...base,
      metadata: { arguments: 'x', stepName: 'ping ada@example.com', transport: 'stdio' },
    });
    const { classes } = redactEvidence(e);
    assert.deepEqual(classes, ['email', 'payload_name']);
  });

  test('a non-scalar is its own class', () => {
    // Past the schema only because a JavaScript caller reached redactMetadata
    // directly; the schema itself rejects this shape.
    const { classes, redacted } = redactMetadata({ policy: { nested: true }, ok: 1 });
    assert.deepEqual(classes, ['non_scalar']);
    assert.deepEqual(redacted, ['policy']);
  });

  test('a key that is itself an email address yields no email address', () => {
    const { redacted, classes } = redactMetadata({ 'victim.bob@example.com_token': 'x' });
    assert.deepEqual(redacted, ['victim.bob@example.com_token']);
    assert.deepEqual(classes, ['payload_name']);
    assert.ok(!classes.some((c) => c.includes('@')));
  });

  test('every class comes from the closed vocabulary, whatever the caller sends', () => {
    const { classes } = redactMetadata({
      arguments: 'x',
      a: 'ada@example.com',
      b: '123-45-6789',
      c: '4111 1111 1111 1111',
      d: '(555) 867-5309',
      e: 'sk-abcdefghijklmnopqrstuv',
      f: 'GB82WEST12345698765432',
      g: [1, 2, 3],
    });
    assert.equal(classes.length, 8);
    for (const c of classes) assert.ok(VOCABULARY.includes(c), `${c} is not in the vocabulary`);
  });

  test('sorted and deduplicated, so one batch does not report the same class twice', () => {
    const { classes } = redactMetadata({ args: 'x', params: 'y', payload: 'z' });
    assert.deepEqual(classes, ['payload_name']);
  });

  test('clean metadata reports nothing at all', () => {
    const { classes } = redactMetadata({ transport: 'stdio', componentCount: 4 });
    assert.deepEqual(classes, []);
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
