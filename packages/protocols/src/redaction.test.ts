import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceInput, PROTOCOLS, redactEvidence } from '@ark/core';
import {
  mcpEvidence, a2aEvidence, agUiEvidence, a2uiEvidence, ucpEvidence, ap2Evidence,
  PROTOCOL_SPEC_VERSIONS, PROTOCOL_LABELS,
} from './index.js';
import { money, vocabulary } from './types.js';

/**
 * The property this package exists to hold, asserted across all six adapters
 * at once rather than one file at a time: a payload handed to an adapter in
 * plain JavaScript does not appear in the adapter's output, and what does
 * come out parses as evidence and survives a second redaction pass unchanged.
 */

const PAYLOAD = 'ada@example.com';
const CARD = '4111111111111111';
const JWT = 'eyJhbGciOiJFUzI1NiJ9.body.sig';

const PAYLOAD_FIELDS = {
  arguments: { email: PAYLOAD },
  args: PAYLOAD,
  params: { card: CARD },
  content: [{ type: 'text', text: PAYLOAD }],
  contents: { blob: CARD },
  result: PAYLOAD,
  structuredContent: { email: PAYLOAD },
  messages: [PAYLOAD],
  message: PAYLOAD,
  delta: PAYLOAD,
  snapshot: { email: PAYLOAD },
  prompt: PAYLOAD,
  systemPrompt: PAYLOAD,
  dataModel: { email: PAYLOAD },
  buyer: { email: PAYLOAD },
  payment: { instruments: [{ credential: { number: CARD } }] },
  signature: JWT,
  checkout_jwt: JWT,
  disclosures: [JWT],
  credentials: 'Bearer secret-token-value',
  apiKey: 'sk-abcdefghijklmnopqrstuvwxyz012345',
  cookie: 'session=abc',
  privateKey: '-----BEGIN PRIVATE KEY-----',
};

const CALLS: [name: string, fn: (o: never) => unknown, base: Record<string, unknown>][] = [
  ['mcp', mcpEvidence as never, { method: 'tools/call', name: 'search_customer', server: 'crm-mcp' }],
  ['a2a', a2aEvidence as never, { operation: 'delegate', agent: 'a', peerAgent: 'b' }],
  ['ag-ui', agUiEvidence as never, { eventType: 'approval.requested' }],
  ['a2ui', a2uiEvidence as never, { operation: 'updateDataModel', surfaceId: 'srf_1' }],
  ['ucp', ucpEvidence as never, { operation: 'complete_checkout', amount: 10, currency: 'USD' }],
  ['ap2', ap2Evidence as never, { operation: 'payment_mandate', mandateRef: 'm_1' }],
];

describe('no adapter carries a payload', () => {
  for (const [name, fn, base] of CALLS) {
    test(`${name}: every known payload field is inert`, () => {
      const out = fn({ ...base, ...PAYLOAD_FIELDS } as never);
      const serialised = JSON.stringify(out);
      for (const needle of [PAYLOAD, CARD, JWT, 'Bearer', 'sk-abcdefghijkl', 'BEGIN PRIVATE KEY']) {
        assert.ok(!serialised.includes(needle), `${name} leaked ${needle}`);
      }
    });

    test(`${name}: output parses as evidence and is already redacted`, () => {
      const out = fn({ ...base, id: `pe_${name}` } as never);
      const parsed = EvidenceInput.safeParse(out);
      assert.ok(parsed.success, `${name} did not parse: ${JSON.stringify(parsed.error?.issues)}`);
      const { redacted } = redactEvidence(parsed.data!);
      assert.deepEqual(redacted, [], `${name} still had ${redacted.join(',')} to redact`);
    });

    test(`${name}: caller metadata is scoped to scalars`, () => {
      const out = fn({ ...base, metadata: { region: 'eu-west-1', nested: { a: 1 }, big: 12 } } as never) as {
        metadata: Record<string, unknown>;
      };
      assert.equal(out.metadata.region, 'eu-west-1');
      assert.equal(out.metadata.big, 12);
      assert.equal(out.metadata.nested, undefined);
    });
  }
});

describe('the package describes itself', () => {
  test('every protocol has a spec version and a label', () => {
    for (const p of PROTOCOLS) {
      assert.ok(PROTOCOL_SPEC_VERSIONS[p], `${p} has no spec version`);
      assert.ok(PROTOCOL_LABELS[p], `${p} has no label`);
    }
  });

  test('each adapter stamps its own protocol and version', () => {
    const seen = CALLS.map(([, fn, base]) => fn(base as never) as { protocol: string; protocolVersion?: string });
    for (const e of seen) {
      assert.equal(e.protocolVersion, PROTOCOL_SPEC_VERSIONS[e.protocol as never]);
    }
    assert.deepEqual(seen.map((e) => e.protocol).sort(), [...PROTOCOLS].sort());
  });
});

describe('money', () => {
  test('only a USD amount becomes a USD figure', () => {
    assert.deepEqual(money(175, 'USD'), { valueUsd: 175, currency: 'USD', amount: 175 });
    assert.deepEqual(money(175, 'gbp'), { valueUsd: undefined, currency: 'GBP', amount: 175 });
    assert.deepEqual(money(175, 'pounds'), { valueUsd: undefined, currency: undefined, amount: 175 });
    assert.deepEqual(money(undefined, 'USD'), { valueUsd: undefined, currency: 'USD', amount: undefined });
    assert.deepEqual(money(-5, 'USD'), { valueUsd: undefined, currency: 'USD', amount: undefined });
    assert.deepEqual(money(Number.NaN, 'USD'), { valueUsd: undefined, currency: 'USD', amount: undefined });
  });
});

describe('vocabulary', () => {
  test('sorts, de-duplicates and drops blanks', () => {
    assert.deepEqual(vocabulary(['Card', 'Text', 'Card', ' ']), { names: 'Card,Text', accepted: ['Card', 'Text', 'Card'], rejected: 0 });
    assert.deepEqual(vocabulary([]), { names: undefined, accepted: [], rejected: 0 });
    assert.deepEqual(vocabulary(undefined), { names: undefined, accepted: [], rejected: 0 });
  });

  test('keeps a custom catalogue’s type names', () => {
    // A2UI allows catalogues beyond the Basic 18, so this cannot be an
    // allowlist without dropping legitimate components.
    assert.deepEqual(vocabulary(['MyOrgChart', 'Acme_Gauge2']), {
      names: 'Acme_Gauge2,MyOrgChart',
      accepted: ['MyOrgChart', 'Acme_Gauge2'],
      rejected: 0,
    });
  });

  test('a form value passed as a component type is counted, not stored', () => {
    const v = vocabulary(['Card', 'bob@example.com', '4111 1111 1111 1111', 'Please confirm your address']);
    assert.equal(v.names, 'Card');
    assert.equal(v.rejected, 3);
  });
});

describe('adapter output always satisfies the schema the SDK parses with', () => {
  test('a caller metadata key that is too long or not an identifier is dropped, not fatal', () => {
    const out = mcpEvidence({
      method: 'tools/call',
      metadata: { ['k'.repeat(70)]: 1, 'bob@example.com': true, '4111-1111-1111-1111': 1, region: 'eu' },
    });
    assert.equal(out.metadata.region, 'eu');
    assert.equal(Object.keys(out.metadata).some((k) => k.startsWith('kkkk') || k.includes('@') || /^\d/.test(k)), false);
    assert.equal(EvidenceInput.safeParse({ ...out, id: 'pe_k' }).success, true);
  });

  test('a numeric card number in metadata is dropped', () => {
    const out = mcpEvidence({ method: 'tools/call', metadata: { ref: 4111111111111111, count: 3 } });
    assert.equal(out.metadata.ref, undefined);
    assert.equal(out.metadata.count, 3);
  });

  test('more caller fields than the cap are trimmed to the cap', () => {
    const metadata = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]));
    const out = mcpEvidence({ method: 'tools/call', metadata });
    assert.ok(Object.keys(out.metadata).length <= 32);
    assert.equal(EvidenceInput.safeParse({ ...out, id: 'pe_cap' }).success, true);
  });

  test('ag-ui surface and run ids carrying PII are redacted', () => {
    const out = agUiEvidence({
      eventType: 'approval.approved',
      surface: 'jane.doe@acme.com',
      runId: 'run 4111 1111 1111 1111',
    } as never);
    const s = JSON.stringify(out);
    assert.ok(!s.includes('jane.doe@acme.com'));
    assert.ok(!s.includes('4111 1111 1111 1111'));
  });
});
