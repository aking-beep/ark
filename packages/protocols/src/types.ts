import {
  redactMetadata,
  EVIDENCE_METADATA_MAX_FIELDS,
  type EvidenceObservation,
  type EvidenceKind,
  type EvidenceOutcome,
  type EvidenceRisk,
  type Protocol,
} from '@ark/core';

/**
 * Fields every adapter accepts, because they are ARK's, not the protocol's.
 *
 * An observer usually knows things the protocol frame does not carry — which
 * trace this happened in, how long it took on the wire, whether this operation
 * is one the org requires a human to sign for. Each adapter supplies a
 * defensible default for `risk`, `outcome` and `requiredApproval`; these
 * override it, because risk appetite is an org's property and not a
 * protocol's.
 */
export interface ObservationBase {
  /** Idempotency key. Omit and `TraceHandle.evidence()` assigns one. */
  id?: string;
  traceId?: string;
  workloadId?: string;
  ts?: number;
  latencyMs?: number;
  outcome?: EvidenceOutcome;
  risk?: EvidenceRisk;
  requiredApproval?: boolean;
  approvedBy?: string | null;
  /** The peer's declared protocol version, when the observer saw it. */
  protocolVersion?: string;
  /** Extra low-cardinality scalars. Redacted on the same terms as everything else. */
  metadata?: Record<string, unknown>;
}

/**
 * What every adapter returns.
 *
 * An `EvidenceObservation` may leave `outcome`, `risk`, `requiredApproval` and
 * `metadata` to the schema's defaults, because someone writing one by hand
 * should not have to say `risk: 'low'` to say nothing. An adapter always
 * decides all four, and saying so in the type is what lets a caller read
 * `mcpEvidence(...).metadata.transport` without a null check.
 */
export type NormalisedEvidence = EvidenceObservation &
  Required<Pick<EvidenceObservation, 'outcome' | 'risk' | 'requiredApproval' | 'metadata'>>;

/** What an adapter resolved from the protocol frame, before ARK's overrides. */
export interface Resolved {
  protocol: Protocol;
  protocolVersion: string;
  kind: EvidenceKind;
  operation: string;
  actor?: string | undefined;
  target?: string | undefined;
  outcome: EvidenceOutcome;
  risk: EvidenceRisk;
  requiredApproval?: boolean | undefined;
  evidenceRef?: string | undefined;
  valueUsd?: number | undefined;
  currency?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

const text = (v: string | undefined, max: number): string | undefined => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};

/**
 * Assemble the evidence an adapter resolved.
 *
 * Two properties matter here and both are load-bearing. Metadata is built from
 * the adapter's own named fields plus the caller's extras, and then passed
 * through `redactMetadata`, so a caller who puts a tool-argument blob under
 * `metadata.arguments` gets it dropped rather than stored. And the object is
 * assembled key by key from `Resolved` rather than spread from the caller's
 * input, so a field the adapter does not name has no path into the output at
 * all — which is why passing `arguments` to `mcpEvidence` in plain JavaScript
 * is inert rather than merely discouraged.
 */
export function compose(base: ObservationBase, r: Resolved): NormalisedEvidence {
  const { metadata } = redactMetadata({ ...r.metadata, ...base.metadata });
  const trimmed = Object.fromEntries(Object.entries(metadata).slice(0, EVIDENCE_METADATA_MAX_FIELDS));

  const out: NormalisedEvidence = {
    protocol: r.protocol,
    protocolVersion: base.protocolVersion ?? r.protocolVersion,
    kind: r.kind,
    operation: text(r.operation, 200) ?? r.protocol,
    outcome: base.outcome ?? r.outcome,
    risk: base.risk ?? r.risk,
    requiredApproval: base.requiredApproval ?? r.requiredApproval ?? false,
    metadata: trimmed,
  };

  if (base.id !== undefined) out.id = base.id;
  if (base.traceId !== undefined) out.traceId = base.traceId;
  if (base.workloadId !== undefined) out.workloadId = base.workloadId;
  if (base.ts !== undefined) out.ts = base.ts;
  if (base.latencyMs !== undefined) out.latencyMs = base.latencyMs;
  if (base.approvedBy !== undefined) out.approvedBy = base.approvedBy;

  const actor = text(r.actor, 200);
  const target = text(r.target, 200);
  const ref = text(r.evidenceRef, 200);
  if (actor) out.actor = actor;
  if (target) out.target = target;
  if (ref) out.evidenceRef = ref;
  if (r.valueUsd !== undefined) out.valueUsd = r.valueUsd;
  if (r.currency !== undefined) out.currency = r.currency;

  return out;
}

export interface Money {
  valueUsd: number | undefined;
  currency: string | undefined;
  /** The observed amount, in the observed currency, for the metadata record. */
  amount: number | undefined;
}

/**
 * Normalise a transaction amount without inventing one.
 *
 * `valueUsd` is populated only when the observation was in USD. Converting at
 * ingest would turn an observation into an estimate, and the dashboard could
 * not then tell you which of the two it was showing — which is the one thing
 * this product refuses to do. A non-USD amount is kept verbatim in metadata
 * with its currency beside it, and the Protocols page says how many of those
 * it excluded from its USD total.
 */
export function money(amount: number | undefined, currency: string | undefined): Money {
  const code = currency?.trim().toUpperCase();
  const valid = code && /^[A-Z]{3}$/.test(code) ? code : undefined;
  const value = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : undefined;
  return {
    valueUsd: valid === 'USD' ? value : undefined,
    currency: valid,
    amount: value,
  };
}

/**
 * A type name: a letter, then letters, digits or underscores, up to 32.
 *
 * The contract on a vocabulary field is that it holds type *names*, and until
 * something enforces that it is a contract the caller keeps rather than one
 * the adapter holds — a form value passed where a component list was expected
 * would be stored verbatim. Shape, not allowlist: A2UI permits custom
 * catalogues, so `MyOrgChart` has to survive while `bob@example.com`,
 * `4111 1111 1111 1111` and a sentence do not.
 */
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export interface Vocabulary {
  /** Sorted, de-duplicated, comma-joined — a vocabulary, not a payload. */
  names: string | undefined;
  /** How many entries did not look like type names and were dropped. */
  rejected: number;
}

export function vocabulary(names: readonly string[] | undefined): Vocabulary {
  if (!names?.length) return { names: undefined, rejected: 0 };
  const trimmed = names.map((n) => String(n).trim()).filter(Boolean);
  const kept = [...new Set(trimmed.filter((n) => TYPE_NAME.test(n)))].sort();
  return {
    names: kept.length ? kept.join(',') : undefined,
    rejected: trimmed.length - trimmed.filter((n) => TYPE_NAME.test(n)).length,
  };
}
