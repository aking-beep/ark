import type { EvidenceKind, EvidenceOutcome, EvidenceRisk } from '@ark/core';
import { compose, type NormalisedEvidence, type ObservationBase } from './types.js';

/**
 * AG-UI — Agent User Interaction Protocol.
 *
 * Built against specification version **1.0** (docs.ag-ui.com/spec/1.0/),
 * whose normative artefact is the JSON Schema at
 * `https://docs.ag-ui.com/spec/1.0/schema.json` — the spec states that when
 * the prose and the schema disagree, the schema wins. 1.0 has 31 event types
 * and removed the 0.x `THINKING_*` family in favour of `REASONING_*`.
 *
 * What ARK wants from AG-UI is the human: how often a person had to
 * intervene, how often they approved, how often they refused, and how long
 * they took. AG-UI 1.0 has no dedicated human-in-the-loop event type — it
 * models the pattern as an *interrupt* layered on the tool-call events — so
 * ARK names that pattern itself. Those names are ARK's and are marked as
 * such; they are not AG-UI event types and are not presented as any.
 *
 * Message content — `delta`, `content`, `snapshot`, `messages`, `result` —
 * has no field here. Counting turns does not require reading them.
 */

export const AGUI_SPEC_VERSION = '1.0';

/** `EventType`, all 31 values of it, verbatim from the 1.0 schema. */
export const AGUI_EVENT_TYPES = [
  'RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR', 'STEP_STARTED', 'STEP_FINISHED',
  'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TEXT_MESSAGE_CHUNK',
  'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_CHUNK', 'TOOL_CALL_RESULT',
  'REASONING_START', 'REASONING_END', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT',
  'REASONING_MESSAGE_END', 'REASONING_MESSAGE_CHUNK', 'REASONING_ENCRYPTED_VALUE',
  'STATE_SNAPSHOT', 'STATE_DELTA', 'MESSAGES_SNAPSHOT',
  'ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA',
  'SUBAGENT_STARTED', 'SUBAGENT_FINISHED', 'SUBAGENT_ERROR',
  'RAW', 'CUSTOM',
] as const;
export type AgUiEventType = (typeof AGUI_EVENT_TYPES)[number];

/**
 * ARK's names for the interrupt pattern AG-UI describes but does not enumerate.
 *
 * Kept lower-case and dotted so they can never be mistaken for the
 * SCREAMING_SNAKE event types above at a glance, in a log, or in a database
 * column.
 */
export const AGUI_INTERACTION_OPERATIONS = [
  'approval.requested', 'approval.approved', 'approval.denied',
  'human_input.requested', 'human_input.received',
  'tool.started', 'tool.completed', 'tool.failed',
  'interrupt.raised', 'interrupt.resolved',
] as const;
export type AgUiInteraction = (typeof AGUI_INTERACTION_OPERATIONS)[number];

const OFFICIAL = new Set<string>(AGUI_EVENT_TYPES);
const ARK_INTERACTION = new Set<string>(AGUI_INTERACTION_OPERATIONS);

export interface AgUiObservation extends ObservationBase {
  /** An AG-UI `EventType`, or one of ARK's interaction operations. */
  eventType: AgUiEventType | AgUiInteraction | string;
  /** The agent driving the run. */
  agent?: string;
  /** The surface or the person at it. */
  surface?: string;
  threadId?: string;
  runId?: string;
  /** Tool identity for the tool-call family. The `delta` carrying its arguments is payload. */
  toolCallName?: string;
  stepName?: string;
  subagentRunId?: string;
  /** Milliseconds a human took to answer. The measurement, not the answer. */
  timeToApprovalMs?: number;
  errorKind?: string;
}

const KIND: Record<string, EvidenceKind> = {
  'approval.requested': 'approval',
  'approval.approved': 'approval',
  'approval.denied': 'approval',
  'human_input.requested': 'human_input',
  'human_input.received': 'human_input',
  'interrupt.raised': 'human_input',
  'interrupt.resolved': 'human_input',
  'tool.started': 'tool',
  'tool.completed': 'tool',
  'tool.failed': 'tool',
  TOOL_CALL_START: 'tool',
  TOOL_CALL_ARGS: 'tool',
  TOOL_CALL_END: 'tool',
  TOOL_CALL_CHUNK: 'tool',
  TOOL_CALL_RESULT: 'tool',
  SUBAGENT_STARTED: 'delegation',
  SUBAGENT_FINISHED: 'delegation',
  SUBAGENT_ERROR: 'delegation',
};

export function agUiKind(eventType: string): EvidenceKind {
  return KIND[eventType] ?? 'ui';
}

const OUTCOME: Record<string, EvidenceOutcome> = {
  'approval.requested': 'pending',
  'approval.approved': 'approved',
  'approval.denied': 'denied',
  'human_input.requested': 'pending',
  'human_input.received': 'ok',
  'interrupt.raised': 'pending',
  'interrupt.resolved': 'ok',
  'tool.started': 'pending',
  'tool.completed': 'ok',
  'tool.failed': 'error',
  RUN_ERROR: 'error',
  SUBAGENT_ERROR: 'error',
  TOOL_CALL_START: 'pending',
  SUBAGENT_STARTED: 'pending',
  STEP_STARTED: 'pending',
  RUN_STARTED: 'pending',
};

export function agUiOutcome(eventType: string, errorKind?: string): EvidenceOutcome {
  if (errorKind) return 'error';
  return OUTCOME[eventType] ?? 'ok';
}

/** Anything that needed a human needed one because somebody judged it risky. */
const RISK: Record<EvidenceKind, EvidenceRisk> = {
  approval: 'medium',
  human_input: 'medium',
  tool: 'medium',
  delegation: 'medium',
  resource: 'low',
  prompt: 'low',
  discovery: 'low',
  task: 'low',
  ui: 'low',
  commerce: 'medium',
  payment: 'high',
  receipt: 'low',
  other: 'low',
};

export function agUiEvidence(o: AgUiObservation): NormalisedEvidence {
  const eventType = String(o.eventType).trim();
  const kind = agUiKind(eventType);
  const official = OFFICIAL.has(eventType);

  return compose(o, {
    protocol: 'ag-ui',
    protocolVersion: AGUI_SPEC_VERSION,
    kind,
    operation: eventType,
    actor: o.agent,
    target: o.surface,
    outcome: agUiOutcome(eventType, o.errorKind),
    risk: RISK[kind],
    // An approval event is, by definition, an operation somebody decided
    // needed one. The caller can still say otherwise.
    requiredApproval: kind === 'approval' ? true : undefined,
    evidenceRef: o.runId,
    metadata: {
      // Whether the operation string came off the wire or out of ARK's own
      // vocabulary. Without this a reader cannot tell which, and would go
      // looking for `approval.requested` in the AG-UI specification.
      operationSource: official ? 'ag-ui' : ARK_INTERACTION.has(eventType) ? 'ark' : 'unknown',
      threadId: o.threadId,
      stepName: o.stepName,
      toolCallName: o.toolCallName,
      subagentRunId: o.subagentRunId,
      timeToApprovalMs: o.timeToApprovalMs,
      errorKind: o.errorKind,
    },
  });
}
