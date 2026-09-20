import type { EvidenceKind, EvidenceOutcome, EvidenceRisk } from '@ark/core';
import { compose, type NormalisedEvidence, type ObservationBase } from './types.js';

/**
 * MCP — Model Context Protocol.
 *
 * Built against specification revision **2026-07-28** (the current revision:
 * https://modelcontextprotocol.io/specification/versioning), with the previous
 * final revision **2025-11-25** recognised as legacy. 2026-07-28 made the
 * protocol stateless and removed `initialize`, `ping`, `logging/setLevel`,
 * `resources/subscribe` and `resources/unsubscribe`; a fleet upgrades one
 * server at a time, so an observer that only knows the current revision would
 * report a rising tide of false anomalies. Both vocabularies are recognised
 * and the revision is recorded per observation.
 *
 * ARK observes MCP. It does not speak it, and it never sees `arguments`,
 * `content`, `structuredContent`, `messages` or a resource body — those fields
 * do not exist on `McpObservation`, and `compose` builds its output from named
 * fields rather than by spreading the input.
 */

export const MCP_SPEC_VERSION = '2026-07-28';
export const MCP_LEGACY_SPEC_VERSION = '2025-11-25';

/** Requests and notifications in revision 2026-07-28. */
export const MCP_METHODS = [
  'server/discover',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'subscriptions/listen',
  'prompts/list',
  'prompts/get',
  'completion/complete',
  'sampling/createMessage',
  'roots/list',
  'elicitation/create',
  'notifications/cancelled',
  'notifications/message',
  'notifications/progress',
  'notifications/tools/list_changed',
  'notifications/resources/list_changed',
  'notifications/resources/updated',
  'notifications/prompts/list_changed',
  'notifications/subscriptions/acknowledged',
] as const;

/** Present in 2025-11-25, removed in 2026-07-28. Still on the wire in the field. */
export const MCP_LEGACY_METHODS = [
  'initialize',
  'ping',
  'logging/setLevel',
  'resources/subscribe',
  'resources/unsubscribe',
  'notifications/initialized',
  'notifications/roots/list_changed',
  'notifications/elicitation/complete',
  'tasks/get',
  'tasks/list',
  'tasks/cancel',
  'tasks/result',
  'notifications/tasks/status',
] as const;

/** Methods of the `io.modelcontextprotocol/tasks` extension, which left core in 2026-07-28. */
export const MCP_TASK_EXTENSION_METHODS = ['tasks/get', 'tasks/update', 'tasks/cancel', 'notifications/tasks'] as const;

export type McpMethod = (typeof MCP_METHODS)[number] | (typeof MCP_LEGACY_METHODS)[number];

const KNOWN = new Set<string>([...MCP_METHODS, ...MCP_LEGACY_METHODS, ...MCP_TASK_EXTENSION_METHODS]);
const LEGACY_ONLY = new Set<string>(
  MCP_LEGACY_METHODS.filter((m) => !(MCP_METHODS as readonly string[]).includes(m)),
);

/** Transports MCP defines. `streamable-http` is the current HTTP binding. */
export const MCP_TRANSPORTS = ['stdio', 'streamable-http', 'sse', 'http'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export interface McpObservation extends ObservationBase {
  /** JSON-RPC method, verbatim, e.g. `tools/call`. */
  method: string;
  /** Tool name, resource URI, or prompt name. The identity, never the payload. */
  name?: string;
  /** The MCP client — usually the agent. */
  client?: string;
  /** The MCP server being called. */
  server?: string;
  transport?: McpTransport;
  /**
   * `CallToolResult.isError`. MCP reports tool failures inside the result with
   * this flag rather than as a JSON-RPC error, so a transport-level success
   * is not the same thing as the tool having worked.
   */
  isError?: boolean;
  /** JSON-RPC error code, when the call failed at the protocol level. */
  errorCode?: number;
  /** A short error class — `timeout`, `not_found`. Never the error body. */
  errorKind?: string;
}

const KIND_BY_PREFIX: [prefix: string, kind: EvidenceKind][] = [
  ['tools/', 'tool'],
  ['resources/', 'resource'],
  ['subscriptions/', 'resource'],
  ['prompts/', 'prompt'],
  ['tasks/', 'task'],
  ['roots/', 'discovery'],
  ['server/', 'discovery'],
  ['elicitation/', 'human_input'],
  ['sampling/', 'other'],
  ['completion/', 'other'],
  ['logging/', 'other'],
];

export function mcpKind(method: string): EvidenceKind {
  if (method === 'initialize' || method === 'ping') return 'discovery';
  const body = method.startsWith('notifications/') ? method.slice('notifications/'.length) : method;
  for (const [prefix, kind] of KIND_BY_PREFIX) {
    if (body.startsWith(prefix)) return kind;
  }
  return 'other';
}

/**
 * Default risk by method.
 *
 * A deterministic table rather than a judgement: `tools/call` can change the
 * world, `sampling/createMessage` asks the client to spend money on a model,
 * and `elicitation/create` puts a question in front of a human. Everything
 * else is reading. Orgs that disagree pass `risk` and this table is ignored.
 */
const RISK: Record<string, EvidenceRisk> = {
  'tools/call': 'medium',
  'sampling/createMessage': 'medium',
  'elicitation/create': 'medium',
};

export function mcpRisk(method: string): EvidenceRisk {
  return RISK[method] ?? 'low';
}

/** `tools/call` becomes `tools/call:search_customer`. The name, not the arguments. */
export function mcpOperation(method: string, name?: string): string {
  const n = name?.trim();
  return n ? `${method}:${n}` : method;
}

export function mcpEvidence(o: McpObservation): NormalisedEvidence {
  const method = o.method.trim();
  const known = KNOWN.has(method);
  const outcome: EvidenceOutcome = o.isError || o.errorCode != null || o.errorKind ? 'error' : 'ok';

  return compose(o, {
    protocol: 'mcp',
    // An observation of a method that only ever existed in the old revision is
    // an observation of an old peer, and saying 2026-07-28 would be a lie.
    protocolVersion: LEGACY_ONLY.has(method) ? MCP_LEGACY_SPEC_VERSION : MCP_SPEC_VERSION,
    kind: mcpKind(method),
    operation: mcpOperation(method, o.name),
    actor: o.client,
    target: o.server,
    outcome,
    risk: mcpRisk(method),
    metadata: {
      method,
      transport: o.transport,
      errorCode: o.errorCode,
      errorKind: o.errorKind,
      // A method the catalogue has never heard of still happened. Flagging it
      // beats dropping it: either a peer is ahead of this adapter, or someone
      // is speaking something that is not MCP.
      methodKnown: known,
    },
  });
}
