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
    assert.deepEqual(vocabulary(['Card', 'Text', 'Card', ' ']), { names: 'Card,Text', rejected: 0 });
    assert.deepEqual(vocabulary([]), { names: undefined, rejected: 0 });
    assert.deepEqual(vocabulary(undefined), { names: undefined, rejected: 0 });
  });

  test('keeps a custom catalogue’s type names', () => {
    // A2UI allows catalogues beyond the Basic 18, so this cannot be an
    // allowlist without dropping legitimate components.
    assert.deepEqual(vocabulary(['MyOrgChart', 'Acme_Gauge2']), {
      names: 'Acme_Gauge2,MyOrgChart',
      rejected: 0,
    });
  });

  test('a form value passed as a component type is counted, not stored', () => {
    const v = vocabulary(['Card', 'bob@example.com', '4111 1111 1111 1111', 'Please confirm your address']);
    assert.equal(v.names, 'Card');
    assert.equal(v.rejected, 3);
  });
});
