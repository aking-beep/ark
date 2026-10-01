import { AgentPolicy, evaluatePolicy, type PolicyEvaluation } from './policy.js';
import type { AgentManifest as Manifest } from '../agents/manifest.js';

/**
 * Built-in policies for request-path enforcement.
 * Callers may pass their own list; omitting it uses these.
 * Unmatched policies stay `unknown` and do not block.
 */
export const DEFAULT_AGENT_POLICIES: AgentPolicy[] = [
  AgentPolicy.parse({
    id: 'pol_production_pii',
    name: 'Production PII',
    when: { environment: 'production', dataClasses: { includes: ['pii'] } },
    require: { policyRefs: true, evaluations: true, humanEscalation: true },
  }),
  AgentPolicy.parse({
    id: 'pol_production_high_risk',
    name: 'Production high risk',
    when: { environment: 'production', riskLevel: 'high' },
    require: { evaluations: true, humanApproval: true, humanEscalation: true },
  }),
  AgentPolicy.parse({
    id: 'pol_financial',
    name: 'Financial permissions',
    when: { permission: { includes: ['financial'] } },
    require: { humanApproval: true, humanEscalation: true },
  }),
  AgentPolicy.parse({
    id: 'pol_destructive',
    name: 'Destructive permissions',
    when: { permission: { includes: ['destructive'] } },
    require: { humanApproval: true, humanEscalation: true },
  }),
];

export interface EnforceVerdict {
  allowed: boolean;
  evaluations: PolicyEvaluation[];
}

/**
 * Evaluate policies against a manifest. `fail` blocks. `unknown` and `pass` do not.
 * An empty policy list allows. This is the request-path gate Runtime calls
 * *before* any adapter `complete()`.
 */
export function enforceAgentPolicies(
  agent: Manifest | unknown,
  policies: AgentPolicy[] | unknown[] = DEFAULT_AGENT_POLICIES,
): EnforceVerdict {
  const list = policies.length ? policies : DEFAULT_AGENT_POLICIES;
  const evaluations = list.map((p) => evaluatePolicy(p, agent));
  const allowed = evaluations.every((e) => e.status !== 'fail');
  return { allowed, evaluations };
}
