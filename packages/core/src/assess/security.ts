import { Workload, DataClass } from '../schema/workload.js';
import { Pattern } from './architecture.js';

/**
 * Security as a property of the assessment, not a separate product.
 *
 * Output is deliberately a control list with owners and a verification hook,
 * because a risk score nobody can act on is decoration. Every control names
 * how ARK Control would later verify it is actually in place.
 */

export type RiskLevel = 'low' | 'moderate' | 'high' | 'severe';

export interface Control {
  id: string;
  requirement: string;
  why: string;
  /** How Control verifies this at runtime, once deployed. */
  verifiedBy: string;
  blocking: boolean;
}

export interface SecurityAssessment {
  level: RiskLevel;
  score: number; // 0..100, higher = more risk
  drivers: string[];
  controls: Control[];
  /** Regimes triggered by the data and the deployment shape. */
  complianceFlags: string[];
}

const SENSITIVE: DataClass[] = ['pii', 'sensitive_pii', 'phi', 'pci', 'financial', 'credentials', 'trade_secret', 'minors'];

export function assessSecurity(w: Workload, pattern: Pattern): SecurityAssessment {
  const drivers: string[] = [];
  const controls: Control[] = [];
  let score = 0;

  const sensitive = w.dataClasses.filter((d) => SENSITIVE.includes(d));
  score += sensitive.length * 10;
  if (sensitive.length) drivers.push(`Sensitive data in the prompt path: ${sensitive.join(', ')}.`);

  const writes = w.actions.filter((a) => a.write);
  score += writes.length * 8;
  const irreversible = w.actions.filter((a) => a.blastRadius === 'irreversible');
  score += irreversible.length * 22;
  const costly = w.actions.filter((a) => a.blastRadius === 'costly');
  score += costly.length * 12;

  if (writes.length) drivers.push(`${writes.length} write action(s) into ${uniq(writes.map((a) => a.system)).join(', ')}.`);
  if (irreversible.length) drivers.push(`Irreversible actions in scope: ${irreversible.map((a) => a.name).join(', ')}.`);

  score += { suggest: 0, approve: 5, bounded: 15, full: 28 }[w.autonomy];
  if (w.autonomy === 'full') drivers.push('Full autonomy — no human in the execution path.');

  if (pattern === 'bounded-agent' || pattern === 'autonomous-agent') {
    score += 12;
    drivers.push('Agentic tool use widens the prompt-injection surface: any retrieved or user-supplied text becomes potential instructions.');
  }
  if (pattern === 'rag') {
    score += 6;
    drivers.push('Retrieval can leak documents across tenants or permission boundaries if the index is not permission-aware.');
  }
  if (w.dataResidency !== 'any' && w.dataResidency !== 'on_prem') {
    drivers.push(`Data must remain in ${w.dataResidency.toUpperCase()} — constrains provider and region choice.`);
  }

  score = Math.min(100, score);
  const level: RiskLevel = score >= 70 ? 'severe' : score >= 45 ? 'high' : score >= 22 ? 'moderate' : 'low';

  // ---- Controls -------------------------------------------------------
  if (sensitive.length) {
    controls.push({
      id: 'SEC-01',
      requirement: 'Redact or tokenise sensitive fields before the prompt is constructed.',
      why: 'Once data is in a provider request it is out of your control boundary, regardless of the retention promise in the contract.',
      verifiedBy: 'Control scans outbound prompt payloads for configured sensitive patterns and alerts on matches.',
      blocking: true,
    });
    controls.push({
      id: 'SEC-02',
      requirement: 'Pin an allow-list of approved providers, models and regions; deny everything else at the gateway.',
      why: 'Shadow AI is the common path by which regulated data reaches an unreviewed endpoint.',
      verifiedBy: 'Control flags any model ID or destination not on the allow-list.',
      blocking: true,
    });
  }
  if (w.dataClasses.includes('credentials')) {
    controls.push({
      id: 'SEC-03',
      requirement: 'Never place credentials in prompt context. Resolve them server-side at tool-invocation time.',
      why: 'Prompts are logged, cached and replayed. Treat anything in a prompt as eventually public.',
      verifiedBy: 'Control pattern-matches for key and token shapes in prompt bodies.',
      blocking: true,
    });
  }
  if (writes.length) {
    controls.push({
      id: 'SEC-04',
      requirement: 'Scope every tool credential to the narrowest permission that works. One service account per tool, not one per agent.',
      why: 'Excessive agent privilege is the most consistently reported blocker to production agent deployment.',
      verifiedBy: 'Control records which credential performed each action and flags use outside declared scope.',
      blocking: true,
    });
  }
  if (irreversible.length || costly.length) {
    const gated = [...irreversible, ...costly];
    controls.push({
      id: 'SEC-05',
      requirement: `Human approval gate on: ${gated.map((a) => a.name).join(', ')}${gated.some((a) => a.valueCeilingUsd) ? ` (above the stated value ceilings)` : ''}.`,
      why: 'The cost of a wrong autonomous action here exceeds the labour saved by removing the approval step.',
      verifiedBy: 'Control asserts an approval record exists for every gated action and alerts on any that executed without one.',
      blocking: true,
    });
  }
  if (pattern === 'bounded-agent' || pattern === 'autonomous-agent' || pattern === 'rag') {
    controls.push({
      id: 'SEC-06',
      requirement: 'Treat all retrieved and user-supplied content as untrusted data, never as instructions. Test with an adversarial injection suite in CI.',
      why: 'Prompt injection is not a prompt-engineering problem; it is an architecture problem solved by privilege separation.',
      verifiedBy: 'Control correlates injection-signature detections with subsequent tool calls.',
      blocking: pattern !== 'rag',
    });
  }
  controls.push({
    id: 'SEC-07',
    requirement: 'Log every model call with workload, user, model, tokens, cost, latency, outcome and any action taken.',
    why: 'Without attribution you cannot answer "who spent this, on what, and what did it do" — the question that arrives first in any incident or audit.',
    verifiedBy: 'This is the ARK Control ingest contract; coverage is measurable as a percentage of known traffic.',
    blocking: false,
  });
  controls.push({
    id: 'SEC-08',
    requirement: 'Per-workload spend ceiling with an automatic circuit breaker.',
    why: 'An agent loop failure is a financial incident that runs at machine speed. Rate limits are a security control, not a billing preference.',
    verifiedBy: 'Control enforces the budget and records every trip of the breaker.',
    blocking: w.autonomy === 'bounded' || w.autonomy === 'full',
  });

  const complianceFlags: string[] = [];
  if (w.dataClasses.includes('phi')) complianceFlags.push('HIPAA — a signed BAA with the model provider is a precondition, not a formality.');
  if (w.dataClasses.includes('pci')) complianceFlags.push('PCI DSS — keep cardholder data out of prompts entirely; there is no compliant way to send it.');
  if (w.dataClasses.includes('minors')) complianceFlags.push('Data concerning minors — heightened duty of care and, in several jurisdictions, separate consent requirements.');
  if (w.regulated.includes('gdpr') || w.dataResidency === 'eu') complianceFlags.push('GDPR — lawful basis, residency and a documented data-processing agreement.');
  if (w.regulated.includes('eu_ai_act')) complianceFlags.push('EU AI Act — classify the system; obligations scale sharply with risk tier.');
  if (w.autonomy !== 'suggest' && w.actions.some((a) => a.valueCeilingUsd)) {
    complianceFlags.push('Automated decisions with financial effect may trigger a right to human review. Confirm with counsel.');
  }

  return { level, score, drivers, controls, complianceFlags };
}

const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));
