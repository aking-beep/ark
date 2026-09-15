import { Workload, SUPPORT_TRIAGE } from '@ark/core';

export const NW_ORG = 'org_northwind';
export const NORTHWIND_WORKLOAD_ID = 'wl_northwind_claims';
export const NORTHWIND_BLOCKED_ID = 'wl_northwind_blocked';

export const NORTHWIND_CLAIMS: Workload = Workload.parse({
  ...SUPPORT_TRIAGE,
  id: NORTHWIND_WORKLOAD_ID,
  name: 'Freight claims intake',
  description: 'Northwind ops classifies inbound freight claims and drafts a disposition.',
});
