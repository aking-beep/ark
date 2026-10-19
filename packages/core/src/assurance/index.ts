import { z } from 'zod';
import { AgentManifest, type AgentManifest as Manifest } from '../agents/manifest.js';

export const CheckStatus = z.enum(['pass', 'warn', 'fail', 'unknown']);
export type CheckStatus = z.infer<typeof CheckStatus>;

const CHECK_DETAIL_MAX = 600;
const CHECK_EVIDENCE_MAX = 16;
const CHECK_EVIDENCE_ITEM_MAX = 500;

export const AssuranceCheck = z.object({
  id: z.string().max(80),
  group: z.enum(['identity', 'provenance', 'model', 'tools', 'permissions', 'data', 'production']),
  title: z.string().max(200),
  status: CheckStatus,
  detail: z.string().max(CHECK_DETAIL_MAX),
  evidence: z.array(z.string().max(CHECK_EVIDENCE_ITEM_MAX)).max(CHECK_EVIDENCE_MAX).default([]),
});
export type AssuranceCheck = z.infer<typeof AssuranceCheck>;

export const AssuranceFinding = z.object({
  severity: z.enum(['info', 'warn', 'fail']),
  checkId: z.string().max(80),
  message: z.string().max(600),
});
export type AssuranceFinding = z.infer<typeof AssuranceFinding>;

export const AssuranceReport = z.object({
  agentId: z.string().max(128),
  timestamp: z.number().int(),
  overallStatus: CheckStatus,
  checks: z.array(AssuranceCheck).max(64),
  findings: z.array(AssuranceFinding).max(64),
  evidence: z.array(z.string().max(500)).max(64),
  summary: z.object({
    pass: z.number().int().min(0),
    warn: z.number().int().min(0),
    fail: z.number().int().min(0),
    unknown: z.number().int().min(0),
  }),
});
export type AssuranceReport = z.infer<typeof AssuranceReport>;

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  if (statuses.includes('unknown')) return 'unknown';
  if (statuses.includes('pass')) return 'pass';
  return 'unknown';
}

/**
 * Deterministic assurance. Every check in the report was executed.
 * Unknown is used when the field is absent — never treated as pass.
 */
export function runAssurance(raw: unknown, now = Date.now()): AssuranceReport {
  const agent = AgentManifest.parse(raw);
  const checks: AssuranceCheck[] = [];
  // Details and evidence carry manifest text (a purpose, policy refs), which
  // the manifest bounds more loosely than a check does. Cap here, once, so a
  // long but valid manifest yields a report instead of a ZodError.
  const push = (c: AssuranceCheck) =>
    checks.push(
      AssuranceCheck.parse({
        ...c,
        detail: c.detail.slice(0, CHECK_DETAIL_MAX),
        evidence: c.evidence.slice(0, CHECK_EVIDENCE_MAX).map((e) => e.slice(0, CHECK_EVIDENCE_ITEM_MAX)),
      }),
    );

  identityChecks(agent, push);
  provenanceChecks(agent, push);
  modelChecks(agent, push);
  toolChecks(agent, push);
  permissionChecks(agent, push);
  dataChecks(agent, push);
  productionChecks(agent, push);

  const findings: AssuranceFinding[] = checks
    .filter((c) => c.status === 'fail' || c.status === 'warn')
    .map((c) => ({
      severity: c.status === 'fail' ? 'fail' : 'warn',
      checkId: c.id,
      message: c.detail,
    }));

  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    unknown: checks.filter((c) => c.status === 'unknown').length,
  };

  const evidence = [...new Set(checks.flatMap((c) => c.evidence))].slice(0, 64);

  return AssuranceReport.parse({
    agentId: agent.id,
    timestamp: now,
    overallStatus: worst(checks.map((c) => c.status)),
    checks,
    findings,
    evidence,
    summary,
  });
}

function identityChecks(a: Manifest, push: (c: AssuranceCheck) => void) {
  push({
    id: 'identity.id',
    group: 'identity',
    title: 'Agent has an ID',
    status: a.id ? 'pass' : 'fail',
    detail: a.id ? `id=${a.id}` : 'No agent id.',
    evidence: [],
  });
  push({
    id: 'identity.name',
    group: 'identity',
    title: 'Agent has a name',
    status: a.name ? 'pass' : 'fail',
    detail: a.name ? `name=${a.name}` : 'No name.',
    evidence: [],
  });
  push({
    id: 'identity.owner',
    group: 'identity',
    title: 'Agent has an owner',
    status: a.owner ? 'pass' : a.environment === 'production' ? 'fail' : 'unknown',
    detail: a.owner ? `owner=${a.owner}` : 'Owner is unknown; not invented.',
    evidence: [],
  });
  push({
    id: 'identity.purpose',
    group: 'identity',
    title: 'Agent has a purpose',
    status: a.purpose || a.description ? 'pass' : 'unknown',
    detail: a.purpose || a.description || 'Purpose is unknown.',
    evidence: [],
  });
}

function provenanceChecks(a: Manifest, push: (c: AssuranceCheck) => void) {
  const src = a.source;
  push({
    id: 'provenance.repository',
    group: 'provenance',
    title: 'Repository known',
    status: src?.repository ? 'pass' : 'unknown',
    detail: src?.repository ?? 'No repository on the manifest.',
    evidence: src?.repository ? [src.repository] : [],
  });
  push({
    id: 'provenance.revision',
    group: 'provenance',
    title: 'Branch or commit known',
    status: src?.commitSha || src?.branch ? 'pass' : 'unknown',
    detail: [src?.branch, src?.commitSha].filter(Boolean).join('@') || 'No branch/commit.',
    evidence: [],
  });
  const paths = a.discovery?.evidencePaths ?? [];
  push({
    id: 'provenance.evidence',
    group: 'provenance',
    title: 'Discovery evidence exists',
    status: paths.length > 0 ? 'pass' : 'unknown',
    detail: paths.length ? `${paths.length} evidence paths` : 'No evidence paths.',
    evidence: paths.slice(0, 16),
  });
}

function modelChecks(a: Manifest, push: (c: AssuranceCheck) => void) {
  push({
    id: 'model.inventory',
    group: 'model',
    title: 'Model inventory present',
    status: a.models.length > 0 ? 'pass' : 'unknown',
    detail: a.models.length ? `${a.models.length} model(s)` : 'No models recorded.',
    evidence: [],
  });
  const unknownProvider = a.models.filter((m) => m.provider === 'unknown' || m.modelId === 'unknown');
  if (a.models.length === 0) {
    push({
      id: 'model.provider',
      group: 'model',
      title: 'Provider known',
      status: 'unknown',
      detail: 'No models to assess.',
      evidence: [],
    });
    return;
  }
  push({
    id: 'model.provider',
    group: 'model',
    title: 'Provider known',
    status: unknownProvider.length ? 'warn' : 'pass',
    detail: unknownProvider.length
      ? `${unknownProvider.length} model(s) have unknown provider or id.`
      : 'All recorded models name a provider.',
    evidence: [],
  });
}

function toolChecks(a: Manifest, push: (c: AssuranceCheck) => void) {
  push({
    id: 'tools.inventory',
    group: 'tools',
    title: 'Tool inventory present',
    status: a.tools.length > 0 ? 'pass' : 'unknown',
    detail: a.tools.length ? `${a.tools.length} tool(s)` : 'No tools recorded.',
    evidence: [],
  });
  const mcpTools = a.tools.filter((t) => t.type === 'mcp');
  push({
    id: 'tools.mcp',
    group: 'tools',
    title: 'MCP usage in server inventory',
    status: mcpTools.length === 0 ? (a.mcpServers.length ? 'pass' : 'unknown') : a.mcpServers.length ? 'pass' : 'fail',
    detail:
      mcpTools.length && !a.mcpServers.length
        ? 'MCP tools recorded but no MCP servers.'
        : `${a.mcpServers.length} MCP server(s).`,
    evidence: [],
  });
}

function permissionChecks(a: Manifest, push: (c: AssuranceCheck) => void) {
  const p = a.permissions;
  const flag = (
    id: string,
    title: string,
    on: boolean | undefined,
    whenOn: CheckStatus,
    detailOn: string,
  ) => {
    if (on === undefined) {
      push({ id, group: 'permissions', title, status: 'unknown', detail: 'Not recorded.', evidence: [] });
      return;
    }
    push({
      id,
      group: 'permissions',
      title,
      status: on ? whenOn : 'pass',
      detail: on ? detailOn : 'Not set.',
      evidence: [],
    });
  };
  flag('perm.wildcard', 'Wildcard permissions', p?.wildcard, 'fail', 'Wildcard permissions are present.');
  flag('perm.write', 'Write permissions', p?.write, 'warn', 'Write permissions are present.');
  flag('perm.destructive', 'Destructive permissions', p?.destructive, 'fail', 'Destructive permissions are present.');
  flag('perm.financial', 'Financial permissions', p?.financial, 'fail', 'Financial permissions are present.');
  flag('perm.execute', 'Broad execute permissions', p?.execute, 'warn', 'Execute permissions are present.');
}

function dataChecks(a: Manifest, push: (c: AssuranceCheck) => void) {
  const d = a.dataAccess;
  const sensitive =
    d?.containsPII ||
    d?.containsFinancial ||
    d?.containsHealth ||
    (d?.dataClasses ?? []).some((c) => ['pii', 'sensitive_pii', 'phi', 'pci', 'financial'].includes(c));
  if (!d) {
    push({
      id: 'data.identified',
      group: 'data',
      title: 'Sensitive data access identified',
      status: 'unknown',
      detail: 'Data access was not recorded.',
      evidence: [],
    });
    return;
  }
  push({
    id: 'data.identified',
    group: 'data',
    title: 'Sensitive data access identified',
    status: sensitive ? 'warn' : 'pass',
    detail: sensitive ? 'Sensitive data classes or flags are set.' : 'No sensitive flags recorded.',
    evidence: [],
  });
  const policies = a.governance?.policyRefs?.length ?? 0;
  push({
    id: 'data.policy',
    group: 'data',
    title: 'Sensitive data has policy references',
    status: !sensitive ? 'pass' : policies > 0 ? 'pass' : 'fail',
    detail: !sensitive ? 'No sensitive data recorded.' : policies ? `${policies} policy ref(s)` : 'Sensitive data with no policy references.',
    evidence: a.governance?.policyRefs ?? [],
  });
  push({
    id: 'data.pii-governance',
    group: 'data',
    title: 'PII access has governance evidence',
    status: !(d.containsPII || (d.dataClasses ?? []).includes('pii'))
      ? 'pass'
      : policies > 0 || a.governance?.humanEscalation
        ? 'pass'
        : 'fail',
    detail: 'PII requires policy refs or human escalation.',
    evidence: [],
  });
}

/**
 * Production gates.
 *
 * Each one needs three facts — is this production, how risky is it, what can
 * it touch — and a manifest may record none of them. A gate passes only when
 * the facts it needs are recorded and satisfy it; when one is missing the
 * gate is `unknown`, never `pass`. An unrecorded environment is not "not
 * production".
 */
function productionChecks(a: Manifest, push: (c: AssuranceCheck) => void) {
  const envUnknown = a.environment === 'unknown';
  const prod = a.environment === 'production';
  const evals = a.governance?.evaluationRefs?.length ?? 0;
  const policies = a.governance?.policyRefs?.length ?? 0;
  const riskUnknown = a.riskLevel === 'unknown';
  const high = a.riskLevel === 'high' || a.riskLevel === 'critical';
  const p = a.permissions;
  const destructive = !!(p?.destructive || p?.financial || p?.wildcard);
  // Not destructive *as far as recorded*: one of the three flags is absent.
  const permsUnknown = !destructive && (p?.destructive === undefined || p?.financial === undefined || p?.wildcard === undefined);
  const approval = a.governance?.approvalRequired;
  const escalation = a.governance?.humanEscalation;

  const refGate = (count: number, what: string): { status: CheckStatus; detail: string } => {
    if (count > 0) return { status: 'pass', detail: `${count} ${what} ref(s)` };
    if (prod) return { status: 'fail', detail: `Production agent has no ${what} refs.` };
    if (envUnknown) return { status: 'unknown', detail: `Environment is not recorded; cannot tell whether ${what} refs are required.` };
    return { status: 'pass', detail: 'Not production.' };
  };

  const evalGate = refGate(evals, 'evaluation');
  push({
    id: 'prod.evals',
    group: 'production',
    title: 'Production agent has evaluations',
    status: evalGate.status,
    detail: evalGate.detail,
    evidence: a.governance?.evaluationRefs ?? [],
  });
  const policyGate = refGate(policies, 'policy');
  push({
    id: 'prod.policies',
    group: 'production',
    title: 'Production agent has policy references',
    status: policyGate.status,
    detail: policyGate.detail,
    evidence: a.governance?.policyRefs ?? [],
  });

  let approvalStatus: CheckStatus;
  let approvalDetail: string;
  if (!prod && !envUnknown) {
    approvalStatus = 'unknown';
    approvalDetail = 'Not production.';
  } else if (approval) {
    approvalStatus = 'pass';
    approvalDetail = 'approvalRequired=true';
  } else if (envUnknown) {
    approvalStatus = 'unknown';
    approvalDetail = 'Environment is not recorded; cannot tell whether approval is required.';
  } else if (high || destructive) {
    approvalStatus = 'fail';
    approvalDetail = 'High-risk production actions without approvalRequired.';
  } else if (riskUnknown || permsUnknown) {
    approvalStatus = 'unknown';
    approvalDetail = riskUnknown
      ? 'Risk level is not recorded; cannot tell whether approval is required.'
      : 'Destructive, financial and wildcard permissions are not all recorded; cannot tell whether approval is required.';
  } else {
    approvalStatus = 'pass';
    approvalDetail = 'Low-risk production agent with no destructive, financial or wildcard permissions.';
  }
  push({
    id: 'prod.approval',
    group: 'production',
    title: 'Human approval for high-risk actions',
    status: approvalStatus,
    detail: approvalDetail,
    evidence: [],
  });

  let escalationStatus: CheckStatus;
  let escalationDetail: string;
  if (!prod && !envUnknown) {
    escalationStatus = 'unknown';
    escalationDetail = 'Not production.';
  } else if (escalation) {
    escalationStatus = 'pass';
    escalationDetail = 'humanEscalation=true';
  } else if (envUnknown) {
    escalationStatus = 'unknown';
    escalationDetail = 'Environment is not recorded; cannot tell whether escalation is required.';
  } else if (high) {
    escalationStatus = 'fail';
    escalationDetail = 'High-risk production without humanEscalation.';
  } else if (riskUnknown) {
    escalationStatus = 'unknown';
    escalationDetail = 'Risk level is not recorded; cannot tell whether escalation is required.';
  } else {
    escalationStatus = 'pass';
    escalationDetail = 'Production agent below high risk.';
  }
  push({
    id: 'prod.escalation',
    group: 'production',
    title: 'Human escalation exists where appropriate',
    status: escalationStatus,
    detail: escalationDetail,
    evidence: [],
  });
}
