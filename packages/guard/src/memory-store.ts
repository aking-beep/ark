import type { ActionReceipt, ActionReceiptStore, ClaimResult, FinalExecutionStatus } from '@ark/core';

/**
 * In-memory `ActionReceiptStore`, for tests and the demo's fallback. Same rules
 * as the libSQL adapter in `@ark/db`, including its CHECKs: a receipt that
 * leaves `not_attempted` must be an `allow` with a key, and owns that key.
 *
 * `claim` is atomic because its body runs without an `await`: JavaScript runs it
 * to completion before any other claim can observe the maps. It is one
 * process's memory: it does not protect two processes from each other.
 */
export class MemoryReceiptStore implements ActionReceiptStore {
  private readonly rows = new Map<string, ActionReceipt>();
  /** `(orgId, idempotencyKeyHash)` -> row key, for receipts that left `not_attempted`. */
  private readonly owners = new Map<string, string>();

  private static rowKey(orgId: string, id: string): string {
    return JSON.stringify([orgId, id]);
  }

  async record(receipt: ActionReceipt): Promise<boolean> {
    const k = MemoryReceiptStore.rowKey(receipt.orgId, receipt.id);
    if (this.rows.has(k)) return false;
    this.rows.set(k, { ...receipt, executionStatus: 'not_attempted' });
    return true;
  }

  async claim(receipt: ActionReceipt): Promise<ClaimResult> {
    if (receipt.idempotencyKeyHash === null) throw new Error('claim requires an idempotency key hash');
    if (receipt.decision !== 'allow') throw new Error('only an allow decision can be claimed');
    const k = MemoryReceiptStore.rowKey(receipt.orgId, receipt.id);
    const ownerKey = JSON.stringify([receipt.orgId, receipt.idempotencyKeyHash]);
    const owner = this.owners.get(ownerKey);
    if (owner !== undefined) return { claimed: false, existing: { ...this.rows.get(owner)! } };
    if (this.rows.has(k)) return { claimed: false, existing: null };
    this.rows.set(k, { ...receipt, executionStatus: 'attempted' });
    this.owners.set(ownerKey, k);
    return { claimed: true };
  }

  async finish(orgId: string, id: string, status: FinalExecutionStatus, updatedAt: number): Promise<void> {
    const k = MemoryReceiptStore.rowKey(orgId, id);
    const row = this.rows.get(k);
    if (row?.executionStatus === 'attempted') this.rows.set(k, { ...row, executionStatus: status, updatedAt });
  }

  async get(orgId: string, id: string): Promise<ActionReceipt | null> {
    const row = this.rows.get(MemoryReceiptStore.rowKey(orgId, id));
    return row ? { ...row } : null;
  }

  async findClaim(orgId: string, idempotencyKeyHash: string): Promise<ActionReceipt | null> {
    const owner = this.owners.get(JSON.stringify([orgId, idempotencyKeyHash]));
    return owner === undefined ? null : { ...this.rows.get(owner)! };
  }

  /** Every receipt for one org, oldest first. */
  async list(orgId: string): Promise<ActionReceipt[]> {
    return [...this.rows.values()]
      .filter((r) => r.orgId === orgId)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .map((r) => ({ ...r }));
  }
}
