import { createClient, type Client, type InValue, type Row } from '@libsql/client';
import type {
  ActionDecisionValue,
  ActionReceipt,
  ActionReceiptStore,
  ClaimResult,
  ExecutionStatus,
  FinalExecutionStatus,
  ReceiptReasonCode,
} from '@ark/core';
import { DDL } from './sql.js';

/**
 * libSQL adapter for `ActionReceiptStore` (guarded-refund-tool).
 *
 * The idempotency claim is one statement: `INSERT ... ON CONFLICT DO NOTHING`
 * against the partial unique index on `(org_id, idempotency_key_hash)` for
 * receipts that left `not_attempted`. SQLite applies it atomically, so two
 * concurrent claims for one key — on one connection or two — cannot both land.
 * `ON CONFLICT DO NOTHING` rather than `INSERT OR IGNORE`: OR IGNORE would also
 * swallow a CHECK violation, and the CHECKs are part of the boundary.
 */

const COLUMNS = [
  'id', 'org_id', 'trace_id', 'agent_id', 'principal', 'tool', 'action', 'resource_type', 'resource_id',
  'policy_id', 'policy_version', 'decision', 'reason_code', 'request_digest', 'execution_status',
  'idempotency_key_hash', 'sender_reported_approval', 'amount_minor', 'currency', 'created_at', 'updated_at',
] as const;

const INSERT = `INSERT INTO action_receipts (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`;

function args(r: ActionReceipt, status: ExecutionStatus): InValue[] {
  return [
    r.id, r.orgId, r.traceId, r.agentId, r.principal, r.tool, r.action, r.resourceType, r.resourceId,
    r.policyId, r.policyVersion, r.decision, r.reasonCode, r.requestDigest, status,
    r.idempotencyKeyHash, r.senderReportedApproval ? 1 : 0, r.amountMinor, r.currency, r.createdAt, r.updatedAt,
  ];
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function fromRow(row: Row): ActionReceipt {
  return {
    orgId: String(row.org_id),
    id: String(row.id),
    traceId: str(row.trace_id),
    agentId: String(row.agent_id),
    principal: str(row.principal),
    tool: String(row.tool),
    action: String(row.action),
    resourceType: str(row.resource_type),
    resourceId: str(row.resource_id),
    policyId: str(row.policy_id),
    policyVersion: num(row.policy_version),
    decision: String(row.decision) as ActionDecisionValue,
    reasonCode: String(row.reason_code) as ReceiptReasonCode,
    requestDigest: String(row.request_digest),
    executionStatus: String(row.execution_status) as ExecutionStatus,
    idempotencyKeyHash: str(row.idempotency_key_hash),
    senderReportedApproval: Number(row.sender_reported_approval) === 1,
    amountMinor: num(row.amount_minor),
    currency: str(row.currency),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class LibsqlActionReceiptStore implements ActionReceiptStore {
  constructor(private readonly client: Client) {}

  async record(receipt: ActionReceipt): Promise<boolean> {
    const res = await this.client.execute({ sql: INSERT, args: args(receipt, 'not_attempted') });
    return res.rowsAffected === 1;
  }

  async claim(receipt: ActionReceipt): Promise<ClaimResult> {
    if (receipt.idempotencyKeyHash === null) throw new Error('claim requires an idempotency key hash');
    const res = await this.client.execute({ sql: INSERT, args: args(receipt, 'attempted') });
    if (res.rowsAffected === 1) return { claimed: true };
    return { claimed: false, existing: await this.findClaim(receipt.orgId, receipt.idempotencyKeyHash) };
  }

  async finish(orgId: string, id: string, status: FinalExecutionStatus, updatedAt: number): Promise<void> {
    await this.client.execute({
      sql: `UPDATE action_receipts SET execution_status = ?, updated_at = ?
            WHERE org_id = ? AND id = ? AND execution_status = 'attempted'`,
      args: [status, updatedAt, orgId, id],
    });
  }

  async get(orgId: string, id: string): Promise<ActionReceipt | null> {
    const res = await this.client.execute({
      sql: `SELECT * FROM action_receipts WHERE org_id = ? AND id = ?`,
      args: [orgId, id],
    });
    return res.rows[0] ? fromRow(res.rows[0]) : null;
  }

  async findClaim(orgId: string, idempotencyKeyHash: string): Promise<ActionReceipt | null> {
    const res = await this.client.execute({
      sql: `SELECT * FROM action_receipts
            WHERE org_id = ? AND idempotency_key_hash = ? AND execution_status <> 'not_attempted'`,
      args: [orgId, idempotencyKeyHash],
    });
    return res.rows[0] ? fromRow(res.rows[0]) : null;
  }

  /** Every receipt for one org, oldest first. For demos and tests. */
  async list(orgId: string): Promise<ActionReceipt[]> {
    const res = await this.client.execute({
      sql: `SELECT * FROM action_receipts WHERE org_id = ? ORDER BY created_at, id`,
      args: [orgId],
    });
    return res.rows.map(fromRow);
  }
}

/** The DDL statements that create `action_receipts` and its indexes. */
export const ACTION_RECEIPTS_DDL: readonly string[] = DDL.filter((s) => /\baction_receipts\b/.test(s));

/**
 * Open a receipt store on `url` (e.g. `file:/tmp/x.db`) and create the table if
 * it is missing. The client is constructed here, inside the adapter package, so
 * callers such as the guard demo never import `@libsql/client` themselves.
 */
export async function openActionReceiptStore(
  url: string,
  authToken?: string,
): Promise<{ store: LibsqlActionReceiptStore; close: () => void }> {
  const client = createClient(authToken ? { url, authToken } : { url });
  for (const stmt of ACTION_RECEIPTS_DDL) await client.execute(stmt);
  return { store: new LibsqlActionReceiptStore(client), close: () => client.close() };
}
