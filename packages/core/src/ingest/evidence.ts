import { z } from 'zod';
import { detectSensitive } from './sensitive.js';

/**
 * Protocol evidence: one normalised observation from an agent protocol.
 *
 * This is a fourth grain, deliberately not folded into the model-event table.
 * An event is one model call and is priced. Evidence is one thing an agent did
 * over a protocol — called a tool, delegated a task, asked a human, authorised
 * a payment — and is governed. Forcing the second into the first would make
 * `SUM(cost)` meaningless and `COUNT(*)` a number nobody could name.
 *
 * The schema is the first of three redaction layers. It admits scalars only,
 * which is what makes "ARK does not store tool arguments" a property of the
 * type rather than a promise in a README. See docs/07-protocol-evidence.md.
 */

export const PROTOCOLS = ['mcp', 'a2a', 'ag-ui', 'a2ui', 'ucp', 'ap2'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const EVIDENCE_KINDS = [
  'tool', 'resource', 'prompt', 'discovery', 'delegation', 'task',
  'human_input', 'approval', 'ui', 'commerce', 'payment', 'receipt', 'other',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * `pending` is the load-bearing member. Without it, an approval that has been
 * requested and not yet answered is indistinguishable from one that completed
 * with nobody signing, and the missing-approval detection would fire on every
 * in-flight request. See `approval_missing` in @ark/db.
 */
export const EVIDENCE_OUTCOMES = ['ok', 'error', 'blocked', 'pending', 'approved', 'denied'] as const;
export type EvidenceOutcome = (typeof EVIDENCE_OUTCOMES)[number];

export const EVIDENCE_RISKS = ['low', 'medium', 'high', 'critical'] as const;
export type EvidenceRisk = (typeof EVIDENCE_RISKS)[number];

/** Outcomes that mean the operation ran to completion and did what it said. */
export const COMPLETED_OUTCOMES: readonly EvidenceOutcome[] = ['ok', 'approved'];

export const EVIDENCE_METADATA_MAX_FIELDS = 32;
export const EVIDENCE_METADATA_MAX_VALUE_CHARS = 200;
export const EVIDENCE_METADATA_MAX_KEY_CHARS = 64;

/**
 * Metadata is for low-cardinality scalars — a transport name, a task state, a
 * component count. Objects and arrays are rejected rather than flattened,
 * because flattening is how a tool-argument blob arrives one key at a time.
 */
export const EvidenceMetadata = z
  .record(
    z.string().min(1).max(EVIDENCE_METADATA_MAX_KEY_CHARS),
    z.union([z.string().max(EVIDENCE_METADATA_MAX_VALUE_CHARS), z.number().finite(), z.boolean()]),
  )
  .refine((m) => Object.keys(m).length <= EVIDENCE_METADATA_MAX_FIELDS, {
    message: `metadata accepts at most ${EVIDENCE_METADATA_MAX_FIELDS} fields, and scalar values only`,
  });
export type EvidenceMetadata = z.infer<typeof EvidenceMetadata>;

export const EvidenceInput = z.object({
  /** Client-supplied idempotency key. Re-posting the same id is a no-op. */
  id: z.string().min(1).max(128),
  /** Correlates this observation to the unit of business work it happened in. */
  traceId: z.string().min(1).max(128).optional(),
  workloadId: z.string().min(1).max(128).optional(),
  ts: z.number().int().optional(),

  protocol: z.enum(PROTOCOLS),
  /** The protocol's own version string, verbatim. Never ARK's version. */
  protocolVersion: z.string().max(64).optional(),

  kind: z.enum(EVIDENCE_KINDS),
  /** The operation in the protocol's vocabulary, e.g. `tools/call:search_customer`. */
  operation: z.string().min(1).max(200),

  /** Who acted — an agent, a client, a platform. */
  actor: z.string().max(200).optional(),
  /** What was acted on — a server, a peer agent, a merchant, a surface. */
  target: z.string().max(200).optional(),

  outcome: z.enum(EVIDENCE_OUTCOMES).default('ok'),
  latencyMs: z.number().int().min(0).optional(),

  /** Populated only when the observed currency is USD. See `currency`. */
  valueUsd: z.number().min(0).optional(),
  /** ISO 4217, as observed. A non-USD amount lives in metadata, unconverted. */
  currency: z.string().length(3).optional(),

  requiredApproval: z.boolean().default(false),
  /** Null/omitted when no approval record exists — what `approval_missing` reads. */
  approvedBy: z.string().max(128).nullable().optional(),

  risk: z.enum(EVIDENCE_RISKS).default('low'),

  /**
   * An opaque identifier for the protocol object this observation refers to —
   * a task id, a mandate id, a receipt id, a checkout id. It is a pointer into
   * the system of record, not a copy of it, and it is never the object itself.
   */
  evidenceRef: z.string().max(200).optional(),

  metadata: EvidenceMetadata.default({}),
});
export type EvidenceInput = z.infer<typeof EvidenceInput>;

/**
 * What a protocol adapter produces: everything but the identity ARK assigns.
 * `TraceHandle.evidence()` fills in the id, trace and workload; a caller
 * posting straight to the API supplies them itself.
 *
 * Built on the schema's *input* type, so the fields that have defaults
 * (`outcome`, `requiredApproval`, `risk`, `metadata`) stay optional. An
 * adapter fills all four; someone writing an observation by hand should not
 * have to type `risk: 'low', metadata: {}` to say nothing.
 */
export type EvidenceObservation = Omit<z.input<typeof EvidenceInput>, 'id' | 'traceId' | 'workloadId'> & {
  id?: string;
  traceId?: string;
  workloadId?: string;
};

/**
 * Metadata keys that name a payload rather than describe one.
 *
 * This is the second redaction layer and the weakest of the three, because a
 * denylist only catches the names it knows. It exists for hand-rolled payloads
 * that do not go through `@ark/protocols`, whose adapters build their output
 * from an allowlist and so have no path for a payload to travel down at all.
 *
 * Matching is case-insensitive and ignores `_`, `-` and `.`, so `tool_args`,
 * `toolArgs` and `tool.args` are all the same key to this list.
 */
const DENIED_METADATA_KEYS = [
  // generic payload containers
  'arguments', 'args', 'params', 'parameters', 'input', 'inputs', 'output', 'outputs',
  'result', 'results', 'content', 'contents', 'body', 'payload', 'data', 'value', 'values',
  'text', 'delta', 'snapshot', 'patch', 'raw', 'rawevent', 'blob', 'attachment', 'attachments',
  // conversation and prompt bodies
  'prompt', 'prompts', 'message', 'messages', 'systemprompt', 'instructions', 'reasoning',
  'completion', 'response', 'answer', 'query', 'question', 'transcript',
  // UI state
  'datamodel', 'components', 'state', 'statedelta', 'surface', 'a2uiclientdatamodel',
  // credentials and cryptography
  'signature', 'signatures', 'jwt', 'sdjwt', 'checkoutjwt', 'kbjwt', 'disclosures',
  'token', 'tokens', 'accesstoken', 'refreshtoken', 'idtoken', 'bearer',
  'apikey', 'secret', 'password', 'passwd', 'credential', 'credentials',
  'privatekey', 'publickey', 'jwk', 'cnf', 'nonce', 'cookie', 'cookies', 'authorization',
  // payment instruments
  'card', 'cardnumber', 'pan', 'cvv', 'cvc', 'iban', 'accountnumber', 'routingnumber',
  'paymentinstrument', 'paymentcredential', 'billingaddress', 'buyer', 'email', 'phone',
] as const;

/**
 * Payload words that stay payload words when something is prefixed onto them,
 * so `toolArgs`, `mandate_signature` and `checkoutJwt` are caught too. Kept
 * deliberately short: a suffix rule on a common word drops honest metadata
 * (`metadata` ends in `data`, `componentCount` ends in `count`), which is why
 * the broad list above is matched whole and only these are matched by suffix.
 */
const DENIED_METADATA_SUFFIXES = [
  'arguments', 'args', 'payload', 'body', 'content', 'contents', 'datamodel',
  'signature', 'credential', 'credentials', 'token', 'secret', 'password',
  'privatekey', 'apikey', 'jwt', 'prompt', 'messages', 'disclosures',
] as const;

const normaliseKey = (k: string) => k.toLowerCase().replace(/[_\-.]/g, '');
const DENIED = new Set<string>(DENIED_METADATA_KEYS.map(normaliseKey));
const DENIED_SUFFIXES = DENIED_METADATA_SUFFIXES.map(normaliseKey);

function isDeniedKey(key: string): boolean {
  const k = normaliseKey(key);
  return DENIED.has(k) || DENIED_SUFFIXES.some((s) => k.length > s.length && k.endsWith(s));
}

/**
 * Third redaction layer, and the one that runs on both sides of the wire.
 *
 * Drops entries whose key names a payload, entries whose *value* trips the
 * existing sensitive-data detectors — that catches an innocently named key
 * like `note` carrying an email address — and entries whose value is not a
 * scalar, which is how a nested payload would arrive from a JavaScript caller
 * that never went through the schema.
 *
 * Deterministic and side-effect free, so `@ark/protocols` can run it while
 * composing, the SDK can run it before the POST (the value never leaves the
 * caller's process), and ingest can run it again before the INSERT, all with
 * the same result.
 *
 * Returns the keys removed. Never the values — a control that logs the payload
 * it found in order to warn you about the payload is not a control.
 */
export function redactMetadata(meta: Record<string, unknown> | undefined): {
  metadata: EvidenceMetadata;
  redacted: string[];
} {
  const metadata: EvidenceMetadata = {};
  const redacted: string[] = [];
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === undefined || value === null) continue;
    if (isDeniedKey(key)) {
      redacted.push(key);
      continue;
    }
    if (typeof value === 'string') {
      if (detectSensitive(value).length > 0) {
        redacted.push(key);
        continue;
      }
      metadata[key] = value.slice(0, EVIDENCE_METADATA_MAX_VALUE_CHARS);
      continue;
    }
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      metadata[key] = value;
      continue;
    }
    redacted.push(key);
  }
  return { metadata, redacted };
}

export interface RedactedEvidence {
  evidence: EvidenceInput;
  /** Metadata keys removed, by name only. */
  redacted: string[];
}

export function redactEvidence(e: EvidenceInput): RedactedEvidence {
  const { metadata, redacted } = redactMetadata(e.metadata);
  return redacted.length === 0 ? { evidence: e, redacted } : { evidence: { ...e, metadata }, redacted };
}
