import type { EvidenceKind, EvidenceOutcome } from '@ark/core';
import { compose, type NormalisedEvidence, type ObservationBase } from './types.js';

/**
 * A2A — Agent2Agent Protocol.
 *
 * Built against specification version **1.0** (a2a-protocol.org/latest/
 * specification/), which is a Growth Stage project of the Agentic AI
 * Foundation at the Linux Foundation. v1.0 renamed every JSON-RPC method to
 * PascalCase (`SendMessage`, not `message/send`) and moved task states to
 * `TASK_STATE_*`. Peers negotiate with an `A2A-Version` header whose absence
 * means `0.3`, so both vocabularies are recognised here.
 *
 * The value of A2A evidence is the *shape of the org chart*: which agent
 * delegated what to which peer, and whether it came back. Message parts —
 * `text`, `raw`, `data` — are the payload and have no field here.
 */

export const A2A_SPEC_VERSION = '1.0';
export const A2A_LEGACY_SPEC_VERSION = '0.3';

/** The IANA-registered well-known URI where an agent publishes its Agent Card. */
export const A2A_AGENT_CARD_PATH = '/.well-known/agent-card.json';

/** JSON-RPC methods in v1.0. */
export const A2A_METHODS = [
  'SendMessage',
  'SendStreamingMessage',
  'GetTask',
  'ListTasks',
  'CancelTask',
  'SubscribeToTask',
  'CreateTaskPushNotificationConfig',
  'GetTaskPushNotificationConfig',
  'ListTaskPushNotificationConfigs',
  'DeleteTaskPushNotificationConfig',
  'GetExtendedAgentCard',
] as const;

/** The 0.3-era slash names, still valid for a peer negotiating `A2A-Version: 0.3`. */
export const A2A_LEGACY_METHODS = [
  'message/send',
  'message/stream',
  'tasks/get',
  'tasks/cancel',
  'tasks/resubscribe',
  'tasks/pushNotificationConfig/set',
  'tasks/pushNotificationConfig/get',
  'tasks/pushNotificationConfig/list',
  'tasks/pushNotificationConfig/delete',
  'agent/getAuthenticatedExtendedCard',
] as const;

/** `TaskState`, verbatim from the normative proto. Note `CANCELED` has one L. */
export const A2A_TASK_STATES = [
  'TASK_STATE_UNSPECIFIED',
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
] as const;
export type A2aTaskState = (typeof A2A_TASK_STATES)[number];

/**
 * ARK's name for the thing A2A does not have a single method for.
 *
 * A2A has no `Delegate` RPC — one agent handing work to another is a
 * `SendMessage` that opens a task on a peer. `delegate` is ARK's label for
 * that relationship, because "which agent gave work to which agent" is the
 * question the evidence exists to answer, and `SendMessage` does not answer
 * it. `discover` is the same for reading a peer's Agent Card.
 */
export const A2A_RELATIONSHIP_OPERATIONS = ['delegate', 'discover'] as const;

export type A2aOperation =
  | (typeof A2A_METHODS)[number]
  | (typeof A2A_LEGACY_METHODS)[number]
  | (typeof A2A_RELATIONSHIP_OPERATIONS)[number];

const LEGACY = new Set<string>(A2A_LEGACY_METHODS);
const KNOWN = new Set<string>([...A2A_METHODS, ...A2A_LEGACY_METHODS, ...A2A_RELATIONSHIP_OPERATIONS]);

const DELEGATION = new Set<string>(['SendMessage', 'SendStreamingMessage', 'message/send', 'message/stream', 'delegate']);
const DISCOVERY = new Set<string>(['GetExtendedAgentCard', 'agent/getAuthenticatedExtendedCard', 'discover']);

export interface A2aObservation extends ObservationBase {
  /** A v1.0 method, a 0.3 method, or `delegate` / `discover`. */
  operation: A2aOperation | string;
  /** The calling agent. */
  agent?: string;
  /** The agent being called. */
  peerAgent?: string;
  /** Task identifier — a reference into the peer's system, not its contents. */
  taskId?: string;
  /** A2A groups related tasks by context. */
  contextId?: string;
  taskState?: A2aTaskState | string;
  /** `JSONRPC`, `GRPC` or `HTTP+JSON`, from the Agent Card's declared interface. */
  protocolBinding?: string;
  /** Count of artefacts produced. The artefacts themselves are payload. */
  artifactCount?: number;
  /** A2A error name, e.g. `TaskNotFoundError`. Never the error body. */
  errorKind?: string;
}

export function a2aKind(operation: string): EvidenceKind {
  if (DELEGATION.has(operation)) return 'delegation';
  if (DISCOVERY.has(operation)) return 'discovery';
  return 'task';
}

/**
 * Map the task lifecycle onto ARK's outcome enum.
 *
 * The interrupted states — `INPUT_REQUIRED`, `AUTH_REQUIRED` — and the
 * in-flight ones map to `pending`, not to `ok`. A task waiting on a human is
 * not a task that succeeded, and treating it as one would make every
 * governance count on the Protocols page optimistic.
 */
export function a2aOutcome(state: string | undefined, errorKind?: string): EvidenceOutcome {
  if (errorKind) return 'error';
  switch (state) {
    case 'TASK_STATE_COMPLETED':
      return 'ok';
    case 'TASK_STATE_FAILED':
      return 'error';
    case 'TASK_STATE_REJECTED':
      return 'denied';
    case 'TASK_STATE_CANCELED':
      return 'blocked';
    case 'TASK_STATE_SUBMITTED':
    case 'TASK_STATE_WORKING':
    case 'TASK_STATE_INPUT_REQUIRED':
    case 'TASK_STATE_AUTH_REQUIRED':
      return 'pending';
    default:
      return 'ok';
  }
}

export function a2aEvidence(o: A2aObservation): NormalisedEvidence {
  const operation = String(o.operation).trim();

  return compose(o, {
    protocol: 'a2a',
    protocolVersion: LEGACY.has(operation) ? A2A_LEGACY_SPEC_VERSION : A2A_SPEC_VERSION,
    kind: a2aKind(operation),
    operation,
    actor: o.agent,
    target: o.peerAgent,
    outcome: a2aOutcome(o.taskState, o.errorKind),
    // One agent handing work to another crosses a trust boundary the operator
    // may not have drawn; reading a card does not.
    risk: a2aKind(operation) === 'delegation' ? 'medium' : 'low',
    evidenceRef: o.taskId,
    metadata: {
      taskState: o.taskState,
      contextId: o.contextId,
      protocolBinding: o.protocolBinding,
      artifactCount: o.artifactCount,
      errorKind: o.errorKind,
      operationKnown: KNOWN.has(operation),
    },
  });
}
