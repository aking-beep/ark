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
  'msg', 'usertext', 'usermessage', 'userinput', 'toolinput', 'tooloutput',
  // free-text containers: not payload words, but conventionally where prose
  // ends up, and prose is where an address or an account number hides
  'note', 'notes', 'memo', 'comment', 'comments', 'description', 'summary',
  'detail', 'details', 'reason', 'freeform',
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
 * Payload words that are payload words wherever they appear in a key, so
 * `toolArgs`, `argsJson`, `mandate_signature` and `checkoutJwt` are all
 * caught. Every entry is a word with no honest use as part of an identifier
 * describing an operation — there is no legitimate metadata field with
 * `signature` or `apikey` in its name.
 */
const DENIED_PAYLOAD_SUBSTRINGS = [
  'arguments', 'args', 'payload', 'datamodel', 'signature', 'credential',
  'password', 'privatekey', 'apikey', 'secret', 'disclosures', 'jwt',
  'cardnumber', 'cvv',
] as const;

/**
 * Payload words that are only payload words at the *end* of a key, because
 * the same letters are load-bearing elsewhere: `contentType` is a MIME type,
 * `tokenCount` is a number, `promptName` is an identifier and `nobody` is not
 * a body. A substring rule on these would drop honest metadata; a suffix rule
 * catches `responseBody`, `systemPrompt`, `promptText` and `resultData`
 * without doing so.
 *
 * It is not free. `metadata` ends in `data` and `context` ends in `text`, so
 * both are denied keys. That is the trade accepted here: neither is a field
 * any adapter emits, both are likelier to hold prose than a scalar fact, and
 * a caller who loses one learns so from the ingest response.
 *
 * A denylist only ever catches the names it knows, which is why it is the
 * weakest of the three layers and why the adapters build from an allowlist
 * instead. Widening it is not the fix for a payload that gets through.
 */
const DENIED_METADATA_SUFFIXES = [
  'body', 'content', 'contents', 'token', 'prompt', 'message', 'messages',
  'text', 'data', 'blob',
] as const;

const normaliseKey = (k: string) => k.toLowerCase().replace(/[_\-.]/g, '');
const DENIED = new Set<string>(DENIED_METADATA_KEYS.map(normaliseKey));
const DENIED_SUBSTRINGS = DENIED_PAYLOAD_SUBSTRINGS.map(normaliseKey);
const DENIED_SUFFIXES = DENIED_METADATA_SUFFIXES.map(normaliseKey);

function isDeniedKey(key: string): boolean {
  const k = normaliseKey(key);
  return DENIED.has(k)
    || DENIED_SUBSTRINGS.some((s) => k.includes(s))
    || DENIED_SUFFIXES.some((s) => k.length > s.length && k.endsWith(s));
}

/**
 * Why an entry was dropped, drawn from a fixed vocabulary.
 *
 * The key name is the caller's string and the value is the caller's data;
 * neither is safe to persist, which is the whole premise of this module. The
 * *reason* is ours. `payload_name` and `non_scalar` are named here, and the
 * rest are `detectSensitive` labels, which the events grain already stores for
 * exactly this purpose.
 *
 * This is what ingest is allowed to write into an alert. See `redactMetadata`.
 */
export type RedactionClass = 'payload_name' | 'non_scalar' | string;

export interface RedactedMetadata {
  metadata: EvidenceMetadata;
  /**
   * Keys removed, by name only. The caller's own strings: safe to hand back to
   * the caller that sent them, never safe to store. Use `classes` for that.
   */
  redacted: string[];
  /** Why, from the fixed vocabulary above. Sorted, deduplicated, storable. */
  classes: RedactionClass[];
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
 * Returns the keys removed and, separately, the classes they were removed
 * under. Never the values — a control that logs the payload it found in order
 * to warn you about the payload is not a control. The same reasoning applies
 * to the key: `bob@example.com_token` is a key name and an email address at
 * once, so anything that outlives the request reports the class, not the key.
 */
export function redactMetadata(meta: Record<string, unknown> | undefined): RedactedMetadata {
  const metadata: EvidenceMetadata = {};
  const redacted: string[] = [];
  const classes = new Set<RedactionClass>();
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === undefined || value === null) continue;
    if (isDeniedKey(key)) {
      redacted.push(key);
      classes.add('payload_name');
      continue;
    }
    if (typeof value === 'string') {
      const hits = detectSensitive(value);
      if (hits.length > 0) {
        redacted.push(key);
        for (const h of hits) classes.add(h);
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
    classes.add('non_scalar');
  }
  return { metadata, redacted, classes: [...classes].sort() };
}

export interface RedactedEvidence {
  evidence: EvidenceInput;
  /** Metadata keys removed, by name only. Return to the sender; do not store. */
  redacted: string[];
  /** Why they were removed, from a fixed vocabulary. Safe to store. */
  classes: RedactionClass[];
}

export function redactEvidence(e: EvidenceInput): RedactedEvidence {
  const { metadata, redacted, classes } = redactMetadata(e.metadata);
  return redacted.length === 0
    ? { evidence: e, redacted, classes }
    : { evidence: { ...e, metadata }, redacted, classes };
}
