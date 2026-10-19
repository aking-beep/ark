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
 *
 * Definite failures are collected first and decide the status on their own:
 * a requirement that cannot be verified does not hide one that plainly fails.
 * Only when nothing fails does an unverifiable requirement make the result
 * `unknown` — never `pass`. An agent with no recorded models, or a model the
 * manifest names as `unknown`, cannot be shown to be on an approved list.
 */
export function evaluatePolicy(rawPolicy: unknown, rawAgent: unknown): PolicyEvaluation {
  const policy = AgentPolicy.parse(rawPolicy);
  const agent = AgentManifest.parse(rawAgent);
  if (!applies(policy.when, agent)) {
    return { policyId: policy.id, matched: false, status: 'unknown', failures: [] };
  }
  const failures: string[] = [];
  const unknowns: string[] = [];
  const req = policy.require;
  if (req.policyRefs && !(agent.governance?.policyRefs?.length)) failures.push('policyRefs required');
  if (req.evaluations && !(agent.governance?.evaluationRefs?.length)) failures.push('evaluations required');
  if (req.humanEscalation && !agent.governance?.humanEscalation) failures.push('humanEscalation required');
  if (req.humanApproval && !agent.governance?.approvalRequired) failures.push('humanApproval required');
  if (req.approvedProviders?.length) {
    if (agent.models.length === 0) {
      unknowns.push('approvedProviders cannot be verified: no models recorded (unknown)');
    }
    for (const m of agent.models) {
      if (m.provider === 'unknown') {
        unknowns.push(`provider of model ${m.modelId} is unknown; cannot verify it is approved`);
      } else if (!req.approvedProviders.includes(m.provider)) {
        failures.push(`provider ${m.provider} not approved`);
      }
    }
  }
  if (req.approvedModels?.length) {
    if (agent.models.length === 0) {
      unknowns.push('approvedModels cannot be verified: no models recorded (unknown)');
    }
    for (const m of agent.models) {
      if (m.modelId === 'unknown') {
        unknowns.push(`model id unknown (provider ${m.provider}); cannot verify it is approved`);
      } else if (!req.approvedModels.includes(m.modelId)) {
        failures.push(`model ${m.modelId} not approved`);
      }
    }
  }
  if (req.loggingEnabled) {
    unknowns.push('loggingEnabled cannot be verified from the manifest (unknown)');
  }
  const status: CheckStatus = failures.length ? 'fail' : unknowns.length ? 'unknown' : 'pass';
  return {
    policyId: policy.id,
    matched: true,
    status,
    failures: [...failures, ...unknowns].slice(0, 32).map((f) => f.slice(0, 400)),
  };
}
