/**
 * Single-tenant by design for now. Multi-tenancy is a phase-3 concern and the
 * schema already carries org_id everywhere, so this is the only place that
 * needs to change.
 */
export const ORG_ID = process.env.ARK_ORG_ID ?? 'org_demo';

export const WINDOW_DAYS = Number(process.env.ARK_WINDOW_DAYS ?? 30);
