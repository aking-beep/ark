import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceInput } from '@ark/core';
import {
  mcpEvidence,
  mcpKind,
  mcpOperation,
  MCP_METHODS,
  MCP_SPEC_VERSION,
  MCP_LEGACY_SPEC_VERSION,
} from './mcp.js';

describe('mcpEvidence', () => {
  test('normalises a tool call into the operation, the pair, and the latency', () => {
    const e = mcpEvidence({
      method: 'tools/call',
      name: 'search_customer',
      client: 'support-agent',
      server: 'crm-mcp',
      transport: 'streamable-http',
      latencyMs: 84,
    });
    assert.equal(e.protocol, 'mcp');
    assert.equal(e.protocolVersion, MCP_SPEC_VERSION);
    assert.equal(e.kind, 'tool');
    assert.equal(e.operation, 'tools/call:search_customer');
    assert.equal(e.actor, 'support-agent');
    assert.equal(e.target, 'crm-mcp');
    assert.equal(e.outcome, 'ok');
    assert.equal(e.latencyMs, 84);
    assert.equal(e.metadata.transport, 'streamable-http');
    assert.equal(e.metadata.methodKnown, true);
  });

  test('does not store raw arguments or results, even when a caller passes them', () => {
    const secret = 'person@example.com';
    const e = mcpEvidence({
      method: 'tools/call',
      name: 'search_customer',
      server: 'crm-mcp',
      // The TypeScript type has no such fields; JavaScript callers can still try.
      arguments: { customerEmail: secret, accountId: '129923' },
      result: { content: [{ type: 'text', text: secret }] },
      structuredContent: { email: secret },
    } as never);
    const serialised = JSON.stringify(e);
    assert.ok(!serialised.includes(secret));
    assert.ok(!serialised.includes('129923'));
    assert.equal(Object.hasOwn(e, 'arguments'), false);
    assert.equal(Object.hasOwn(e, 'result'), false);
    assert.deepEqual(Object.keys(e.metadata).sort(), ['method', 'methodKnown']);
  });

  test('drops a payload smuggled through the caller metadata escape hatch', () => {
    const e = mcpEvidence({
      method: 'tools/call',
      name: 'search_customer',
      metadata: { arguments: 'customerEmail=person@example.com', region: 'eu-west-1' },
    });
    assert.equal(e.metadata.arguments, undefined);
    assert.equal(e.metadata.region, 'eu-west-1');
  });

  test('isError on the result is an error, not a success with a flag', () => {
    const ok = mcpEvidence({ method: 'tools/call', name: 'charge', isError: false });
    const bad = mcpEvidence({ method: 'tools/call', name: 'charge', isError: true });
    assert.equal(ok.outcome, 'ok');
    assert.equal(bad.outcome, 'error');
  });

  test('a method that only existed before 2026-07-28 is dated as the old revision', () => {
    assert.equal(mcpEvidence({ method: 'resources/subscribe' }).protocolVersion, MCP_LEGACY_SPEC_VERSION);
    assert.equal(mcpEvidence({ method: 'initialize' }).protocolVersion, MCP_LEGACY_SPEC_VERSION);
    assert.equal(mcpEvidence({ method: 'subscriptions/listen' }).protocolVersion, MCP_SPEC_VERSION);
  });

  test('an unrecognised method is recorded and flagged, never dropped', () => {
    const e = mcpEvidence({ method: 'tools/teleport' });
    assert.equal(e.operation, 'tools/teleport');
    assert.equal(e.metadata.methodKnown, false);
    assert.equal(e.kind, 'tool');
  });

  test('every method in the current vocabulary maps to a kind and parses as evidence', () => {
    for (const method of MCP_METHODS) {
      const e = mcpEvidence({ method, id: `pe_${method}` });
      assert.ok(EvidenceInput.safeParse(e).success, `${method} did not parse`);
    }
  });

  test('risk is a table, not a judgement', () => {
    assert.equal(mcpEvidence({ method: 'tools/call', name: 'x' }).risk, 'medium');
    assert.equal(mcpEvidence({ method: 'tools/list' }).risk, 'low');
    assert.equal(mcpEvidence({ method: 'tools/call', name: 'x', risk: 'critical' }).risk, 'critical');
  });

  test('kind and operation helpers are exported for callers doing their own mapping', () => {
    assert.equal(mcpKind('resources/read'), 'resource');
    assert.equal(mcpKind('prompts/get'), 'prompt');
    assert.equal(mcpKind('elicitation/create'), 'human_input');
    assert.equal(mcpKind('notifications/tools/list_changed'), 'tool');
    assert.equal(mcpOperation('tools/list'), 'tools/list');
    assert.equal(mcpOperation('tools/call', 'github.search'), 'tools/call:github.search');
  });
});
