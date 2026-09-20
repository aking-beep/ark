import type { EvidenceOutcome } from '@ark/core';
import { compose, vocabulary, type NormalisedEvidence, type ObservationBase } from './types.js';

/**
 * A2UI — Agent-to-User Interface.
 *
 * Built against specification version **0.9.1**, the current production
 * release (a2ui.org/specification/v0.9.1-a2ui/). Version 1.0 is a release
 * candidate, not a release; its two additional server operations are
 * recognised so an early adopter is observed rather than rejected, and an
 * observation of one records 1.0 as the version rather than claiming 0.9.1.
 *
 * A2UI defines no transport of its own — it rides inside A2A message parts or
 * AG-UI events — so in practice this adapter is fed by whatever is already
 * observing those.
 *
 * The entire A2UI data model is user-facing content: a form the person is
 * filling in. There is no field here for it, and there is no field for
 * `path` either, because a JSON pointer into someone's checkout form leaks
 * the shape of their data even when it does not leak the values. What ARK
 * records is the vocabulary — which *kinds* of component an agent asked to
 * render, and how many — which is what UI governance actually needs.
 */

export const A2UI_SPEC_VERSION = '0.9.1';
export const A2UI_CANDIDATE_SPEC_VERSION = '1.0';

/** Server→client envelope keys in 0.9.1. Every message carries exactly one. */
export const A2UI_SERVER_OPERATIONS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
] as const;

/** Added by the 1.0 candidate: bidirectional RPC between surface and agent. */
export const A2UI_CANDIDATE_SERVER_OPERATIONS = ['callFunction', 'actionResponse'] as const;

/** Client→server envelope keys. `functionResponse` is 1.0-only. */
export const A2UI_CLIENT_OPERATIONS = ['action', 'error', 'functionResponse'] as const;

/** The Basic Catalog component vocabulary — 18 types. */
export const A2UI_BASIC_CATALOG_COMPONENTS = [
  'Text', 'Image', 'Icon', 'Video', 'AudioPlayer',
  'Row', 'Column', 'List', 'Card', 'Tabs', 'Divider', 'Modal',
  'Button', 'CheckBox', 'TextField', 'DateTimeInput', 'ChoicePicker', 'Slider',
] as const;

export type A2uiOperation =
  | (typeof A2UI_SERVER_OPERATIONS)[number]
  | (typeof A2UI_CANDIDATE_SERVER_OPERATIONS)[number]
  | (typeof A2UI_CLIENT_OPERATIONS)[number];

const CANDIDATE_ONLY = new Set<string>([...A2UI_CANDIDATE_SERVER_OPERATIONS, 'functionResponse']);
const KNOWN = new Set<string>([
  ...A2UI_SERVER_OPERATIONS,
  ...A2UI_CANDIDATE_SERVER_OPERATIONS,
  ...A2UI_CLIENT_OPERATIONS,
]);

/**
 * What the trusted frontend decided to do with what the agent asked for.
 *
 * The distinction this makes possible is the point of observing A2UI at all:
 * agent-requested UI, policy-evaluated UI, and rendered UI are three
 * different populations, and a surface that renders everything an agent asks
 * for is a surface with no policy.
 */
export const A2UI_POLICY_DECISIONS = ['rendered', 'blocked', 'denied', 'pending'] as const;
export type A2uiPolicyDecision = (typeof A2UI_POLICY_DECISIONS)[number];

export interface A2uiObservation extends ObservationBase {
  operation: A2uiOperation | string;
  /** The agent that requested the UI. */
  agent?: string;
  /** The surface the request was aimed at. */
  surfaceId?: string;
  catalogId?: string;
  /** Component *type* names from the catalog — the vocabulary, not the tree. */
  components?: readonly string[];
  /** How many components the message carried. */
  componentCount?: number;
  /** What the trusted frontend did with the request. */
  policy?: A2uiPolicyDecision;
  errorKind?: string;
}

const OUTCOME: Record<A2uiPolicyDecision, EvidenceOutcome> = {
  rendered: 'ok',
  blocked: 'blocked',
  denied: 'denied',
  pending: 'pending',
};

export function a2uiEvidence(o: A2uiObservation): NormalisedEvidence {
  const operation = String(o.operation).trim();
  const components = vocabulary(o.components);
  const policy = o.policy;

  return compose(o, {
    protocol: 'a2ui',
    protocolVersion: CANDIDATE_ONLY.has(operation) ? A2UI_CANDIDATE_SPEC_VERSION : A2UI_SPEC_VERSION,
    kind: 'ui',
    operation,
    actor: o.agent,
    target: o.surfaceId,
    outcome: o.errorKind ? 'error' : policy ? OUTCOME[policy] : 'ok',
    // Interactive components collect input from a person; a Text and an Image
    // do not. That is the whole of the risk difference at this grain.
    risk: hasInteractive(o.components) ? 'medium' : 'low',
    evidenceRef: o.surfaceId,
    metadata: {
      catalogId: o.catalogId,
      componentTypes: components,
      componentCount: o.componentCount ?? o.components?.length,
      policy,
      errorKind: o.errorKind,
      operationKnown: KNOWN.has(operation),
    },
  });
}

const INTERACTIVE = new Set<string>(['Button', 'CheckBox', 'TextField', 'DateTimeInput', 'ChoicePicker', 'Slider']);

function hasInteractive(components: readonly string[] | undefined): boolean {
  return !!components?.some((c) => INTERACTIVE.has(c));
}
