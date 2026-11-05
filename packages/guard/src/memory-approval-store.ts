import type { ApprovalGrant, ApprovalRequestRecord, ApprovalStore } from '@ark/core';

/**
 * In-memory `ApprovalStore`, for tests and the demo.
 *
 * `redeem` is atomic for the same reason `MemoryReceiptStore.claim` is: its
 * body runs to completion without an `await`, so JavaScript cannot interleave
 * a second redemption between the read and the write. That makes a grant
 * single-use within one process. It does NOT protect two processes from each
 * other — a real deployment needs the libSQL adapter, where the same guarantee
 * comes from a conditional UPDATE.
 */
export class MemoryApprovalStore implements ApprovalStore {
  private readonly rows = new Map<string, ApprovalRequestRecord>();

  private static key(orgId: string, decisionId: string): string {
    return JSON.stringify([orgId, decisionId]);
  }

  async open(record: ApprovalRequestRecord): Promise<boolean> {
    const k = MemoryApprovalStore.key(record.orgId, record.decisionId);
    if (this.rows.has(k)) return false;
    this.rows.set(k, { ...record, status: 'pending', grant: null, redeemedAt: null });
    return true;
  }

  async get(orgId: string, decisionId: string): Promise<ApprovalRequestRecord | null> {
    const row = this.rows.get(MemoryApprovalStore.key(orgId, decisionId));
    return row ? { ...row } : null;
  }

  async listPending(orgId: string, now: number): Promise<ApprovalRequestRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.orgId === orgId && r.status === 'pending' && now < r.expiresAt)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({ ...r }));
  }

  async approve(orgId: string, decisionId: string, grant: ApprovalGrant, at: number): Promise<boolean> {
    const k = MemoryApprovalStore.key(orgId, decisionId);
    const row = this.rows.get(k);
    // Only a pending ask can be approved: approving twice, or after a denial,
    // would mint a second chance at an action someone already settled.
    if (row === undefined || row.status !== 'pending') return false;
    if (at >= row.expiresAt) return false;
    if (grant.orgId !== orgId || grant.decisionId !== decisionId) return false;
    this.rows.set(k, {
      ...row, status: 'approved', approvedBy: grant.approvedBy, resolvedAt: at, grant,
    });
    return true;
  }

  async deny(orgId: string, decisionId: string, by: string, at: number): Promise<boolean> {
    const k = MemoryApprovalStore.key(orgId, decisionId);
    const row = this.rows.get(k);
    if (row === undefined || row.status !== 'pending') return false;
    this.rows.set(k, { ...row, status: 'denied', approvedBy: by, resolvedAt: at, grant: null });
    return true;
  }

  async redeem(orgId: string, decisionId: string, at: number): Promise<ApprovalGrant | null> {
    const k = MemoryApprovalStore.key(orgId, decisionId);
    const row = this.rows.get(k);
    if (row === undefined || row.status !== 'approved' || row.grant === null) return null;
    if (row.redeemedAt !== null) return null;
    if (at >= row.expiresAt || at >= row.grant.expiresAt) return null;
    const grant = row.grant;
    // Clearing the grant and stamping the time in the same synchronous step is
    // what makes this one-shot.
    this.rows.set(k, { ...row, grant: null, redeemedAt: at });
    return grant;
  }
}
