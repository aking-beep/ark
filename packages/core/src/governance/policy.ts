import { z } from 'zod';
import { AgentEnvironment, AgentManifest, AgentRiskLevel, type AgentManifest as Manifest } from '../agents/manifest.js';
import type { CheckStatus } from '../assurance/index.js';

export const PolicyCondition = z.object({
  environment: AgentEnvironment.optional(),
  riskLevel: AgentRiskLevel.optional(),
  dataClasses: z.object({ includes: z.array(z.string().max(40)).max(16) }).optional(),
  permission: z
    .object({
      includes: z.array(z.enum(['read', 'write', 'execute', 'financial', 'destructive', 'wildcard'])).max(8),
    })
    .optional(),
});
export type PolicyCondition = z.infer<typeof PolicyCondition>;

export const PolicyRequirement = z.object({
  policyRefs: z.boolean().optional(),
  evaluations: z.boolean().optional(),
  humanEscalation: z.boolean().optional(),
  humanApproval: z.boolean().optional(),
  approvedProviders: z.array(z.string().max(40)).max(16).optional(),
  approvedModels: z.array(z.string().max(200)).max(32).optional(),
  loggingEnabled: z.boolean().optional(),
});
export type PolicyRequirement = z.infer<typeof PolicyRequirement>;

export const AgentPolicy = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  when: PolicyCondition.default({}),
  require: PolicyRequirement.default({}),
});
export type AgentPolicy = z.infer<typeof AgentPolicy>;

export const PolicyEvaluation = z.object({
  policyId: z.string(),
  matched: z.boolean(),
  status: z.enum(['pass', 'fail', 'unknown']),
  failures: z.array(z.string().max(400)).max(32),
});
export type PolicyEvaluation = z.infer<typeof PolicyEvaluation>;

function applies(when: PolicyCondition, agent: Manifest): boolean {
  if (when.environment && agent.environment !== when.environment) return false;
  if (when.riskLevel && agent.riskLevel !== when.riskLevel) return false;
  if (when.dataClasses?.includes?.length) {
    const have = new Set(agent.dataAccess?.dataClasses ?? []);
    if (!when.dataClasses.includes.some((c) => have.has(c as never))) return false;
  }
  if (when.permission?.includes?.length) {
    const p = agent.permissions ?? {};
    if (!when.permission.includes.some((k) => p[k] === true)) return false;
  }
  return true;
}

/**
 * Evaluate a policy against a manifest. Unmatched policies return status
 * unknown (they did not apply). Request-path blocking lives in `enforce.ts`.
 */
export function evaluatePolicy(rawPolicy: unknown, rawAgent: unknown): PolicyEvaluation {
  const policy = AgentPolicy.parse(rawPolicy);
  const agent = AgentManifest.parse(rawAgent);
  if (!applies(policy.when, agent)) {
    return { policyId: policy.id, matched: false, status: 'unknown', failures: [] };
  }
  const failures: string[] = [];
  const req = policy.require;
  if (req.policyRefs && !(agent.governance?.policyRefs?.length)) failures.push('policyRefs required');
  if (req.evaluations && !(agent.governance?.evaluationRefs?.length)) failures.push('evaluations required');
  if (req.humanEscalation && !agent.governance?.humanEscalation) failures.push('humanEscalation required');
  if (req.humanApproval && !agent.governance?.approvalRequired) failures.push('humanApproval required');
  if (req.approvedProviders?.length) {
    for (const m of agent.models) {
      if (!req.approvedProviders.includes(m.provider)) failures.push(`provider ${m.provider} not approved`);
    }
  }
  if (req.approvedModels?.length) {
    for (const m of agent.models) {
      if (m.modelId !== 'unknown' && !req.approvedModels.includes(m.modelId)) {
        failures.push(`model ${m.modelId} not approved`);
      }
    }
  }
  if (req.loggingEnabled) {
    failures.push('loggingEnabled cannot be verified from the manifest (unknown)');
    return { policyId: policy.id, matched: true, status: 'unknown', failures };
  }
  const status: CheckStatus = failures.length ? 'fail' : 'pass';
  return { policyId: policy.id, matched: true, status, failures };
}
