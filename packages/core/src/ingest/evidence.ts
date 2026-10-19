import { z } from 'zod';
import { detectSensitive, redactSensitiveText } from './sensitive.js';
import { IngestTimestamp, LatencyMs, ValueUsd } from './limits.js';

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
  ts: IngestTimestamp.optional(),

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
  latencyMs: LatencyMs.optional(),

  /** Populated only when the observed currency is USD. See `currency`. */
  valueUsd: ValueUsd.optional(),
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
  /** Registered Agent Manifest id. Optional — omit and the observation still ingests. */
  agentId: z.string().min(1).max(128).optional(),
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
 * *reason* is ours. `payload_name`, `non_scalar`, `invalid_key` (a key not
 * shaped like an identifier) and `over_limit` (past the field cap) are named
 * here, and the rest are `detectSensitive` labels, which the events grain already stores for
 * exactly this purpose.
 *
 * This is what ingest is allowed to write into an alert. See `redactMetadata`.
 */
export type RedactionClass = 'payload_name' | 'non_scalar' | 'invalid_key' | 'over_limit' | string;

/**
 * The shape a metadata key must have to be kept: an identifier, not prose.
 * A key that is an email address, a card number or a sentence is dropped as
 * `invalid_key` before anything else looks at it.
 */
export const EVIDENCE_METADATA_KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

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
 * Drops entries whose key names a payload, whose key is not shaped like an
 * identifier, or whose key or *value* trips the sensitive-data detectors —
 * that catches an innocently named key like `note` carrying an email address,
 * and a number like `4111111111111111` carrying a card. Also drops values that
 * are not scalars, which is how a nested payload would arrive from a
 * JavaScript caller that never went through the schema, and anything past the
 * field limit.
 *
 * Deterministic and side-effect free, so `@ark/protocols` can run it while
 * composing, the SDK can run it before the POST (the value never leaves the
 * caller's process), and ingest can run it again before the INSERT, all with
 * the same result. Its output always satisfies `EvidenceMetadata`, so a
 * redacted record can never be the reason a batch is rejected.
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
  let kept = 0;
  const drop = (key: string, ...why: RedactionClass[]) => {
    redacted.push(key);
    for (const w of why) classes.add(w);
  };
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === undefined || value === null) continue;
    if (isDeniedKey(key)) {
      drop(key, 'payload_name');
      continue;
    }
    if (!EVIDENCE_METADATA_KEY_SHAPE.test(key)) {
      drop(key, 'invalid_key');
      continue;
    }
    const keyHits = detectSensitive(key);
    if (keyHits.length > 0) {
      drop(key, ...keyHits);
      continue;
    }
    let clean: string | number | boolean;
    if (typeof value === 'string') {
      const hits = detectSensitive(value);
      if (hits.length > 0) {
        drop(key, ...hits);
        continue;
      }
      clean = value.slice(0, EVIDENCE_METADATA_MAX_VALUE_CHARS);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      // A number is text to a detector: a card or an account number is
      // still one without the quotes.
      const hits = detectSensitive(String(value));
      if (hits.length > 0) {
        drop(key, ...hits);
        continue;
      }
      clean = value;
    } else if (typeof value === 'boolean') {
      clean = value;
    } else {
      drop(key, 'non_scalar');
      continue;
    }
    if (kept >= EVIDENCE_METADATA_MAX_FIELDS) {
      drop(key, 'over_limit');
      continue;
    }
    metadata[key] = clean;
    kept++;
  }
  return { metadata, redacted, classes: [...classes].sort() };
}

/**
 * The free-text fields of an evidence record, with their schema lengths. Each
 * is an identifier or an operation name by contract, and each is also a string
 * a caller controls — an MCP resource URI can carry a home directory with an
 * email address in it.
 *
 * Ids (`id`, `traceId`, `workloadId`) are deliberately not here: they are
 * idempotency and join keys, and rewriting them would split one record in two.
 */
export const EVIDENCE_TEXT_FIELDS = {
  operation: 200,
  actor: 200,
  target: 200,
  evidenceRef: 200,
  approvedBy: 128,
  protocolVersion: 64,
} as const;
export type EvidenceTextField = keyof typeof EVIDENCE_TEXT_FIELDS;

export interface RedactedFields<T> {
  value: T;
  /** Which fields had a match replaced, by field name (ours, not the caller's). */
  fields: EvidenceTextField[];
  classes: RedactionClass[];
}

/**
 * Replace sensitive matches inside the evidence text fields with
 * `[redacted:<class>]`, keeping the rest of the string, and re-cap each field
 * at its schema length. Returns the same object when nothing matched.
 */
export function redactEvidenceFields<T extends Partial<Record<EvidenceTextField, string | null | undefined>>>(
  e: T,
): RedactedFields<T> {
  const fields: EvidenceTextField[] = [];
  const classes = new Set<RedactionClass>();
  let out: T = e;
  for (const [field, max] of Object.entries(EVIDENCE_TEXT_FIELDS) as [EvidenceTextField, number][]) {
    const v = e[field];
    if (typeof v !== 'string' || v.length === 0) continue;
    const { text, labels } = redactSensitiveText(v);
    if (labels.length === 0) continue;
    if (out === e) out = { ...e };
    (out as Record<string, unknown>)[field] = text.slice(0, max);
    fields.push(field);
    for (const l of labels) classes.add(l);
  }
  return { value: out, fields, classes: [...classes].sort() };
}

export interface RedactedEvidence {
  evidence: EvidenceInput;
  /** Metadata keys removed, by name only. Return to the sender; do not store. */
  redacted: string[];
  /** Text fields whose sensitive matches were replaced in place. Field names are ours. */
  fields: EvidenceTextField[];
  /** Why, from a fixed vocabulary. Safe to store. Covers metadata and text fields. */
  classes: RedactionClass[];
}

export function redactEvidence(e: EvidenceInput): RedactedEvidence {
  const { metadata, redacted, classes } = redactMetadata(e.metadata);
  const f = redactEvidenceFields(e);
  const allClasses = [...new Set([...classes, ...f.classes])].sort();
  if (redacted.length === 0 && f.fields.length === 0) {
    return { evidence: e, redacted, fields: [], classes: allClasses };
  }
  const evidence: EvidenceInput = redacted.length === 0 ? f.value : { ...f.value, metadata };
  return { evidence, redacted, fields: f.fields, classes: allClasses };
}
