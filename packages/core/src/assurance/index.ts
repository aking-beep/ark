import { z } from 'zod';
import { AgentManifest, type AgentManifest as Manifest } from '../agents/manifest.js';

export const CheckStatus = z.enum(['pass', 'warn', 'fail', 'unknown']);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const AssuranceCheck = z.object({
  id: z.string().max(80),
  group: z.enum(['identity', 'provenance', 'model', 'tools', 'permissions', 'data', 'production']),
  title: z.string().max(200),
  status: CheckStatus,
  detail: z.string().max(600),
  evidence: z.array(z.string().max(500)).max(16).default([]),
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
  const push = (c: AssuranceCheck) => checks.push(AssuranceCheck.parse(c));

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

function productionChecks(a: Manifest, push: (c: AssuranceCheck) => void) {
  const prod = a.environment === 'production';
  const evals = a.governance?.evaluationRefs?.length ?? 0;
  const policies = a.governance?.policyRefs?.length ?? 0;
  const high = a.riskLevel === 'high' || a.riskLevel === 'critical';
  const destructive = a.permissions?.destructive || a.permissions?.financial || a.permissions?.wildcard;

  push({
    id: 'prod.evals',
    group: 'production',
    title: 'Production agent has evaluations',
    status: !prod ? 'pass' : evals > 0 ? 'pass' : 'fail',
    detail: !prod ? 'Not production.' : evals ? `${evals} evaluation ref(s)` : 'Production agent has no evaluation refs.',
    evidence: a.governance?.evaluationRefs ?? [],
  });
  push({
    id: 'prod.policies',
    group: 'production',
    title: 'Production agent has policy references',
    status: !prod ? 'pass' : policies > 0 ? 'pass' : 'fail',
    detail: !prod ? 'Not production.' : policies ? `${policies} policy ref(s)` : 'Production agent has no policy refs.',
    evidence: a.governance?.policyRefs ?? [],
  });
  push({
    id: 'prod.approval',
    group: 'production',
    title: 'Human approval for high-risk actions',
    status: !(prod && (high || destructive))
      ? prod
        ? 'pass'
        : 'unknown'
      : a.governance?.approvalRequired
        ? 'pass'
        : 'fail',
    detail: a.governance?.approvalRequired ? 'approvalRequired=true' : 'High-risk production actions without approvalRequired.',
    evidence: [],
  });
  push({
    id: 'prod.escalation',
    group: 'production',
    title: 'Human escalation exists where appropriate',
    status: !(prod && high) ? (prod ? 'pass' : 'unknown') : a.governance?.humanEscalation ? 'pass' : 'fail',
    detail: a.governance?.humanEscalation ? 'humanEscalation=true' : 'High-risk production without humanEscalation.',
    evidence: [],
  });
}
