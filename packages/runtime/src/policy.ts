import type { AdapterId, ProviderAdapter } from '@ark/providers';
import type { Exclusion, RuntimeConstraints } from './types.js';
import {
  catalogModelId,
  completionFrom,
  costConstraintApplies,
  heuristicLatencyMs,
  latencyConstraintApplies,
  estimateCostUsd,
} from './catalog.js';

export interface PolicyInput {
  adapters: ProviderAdapter[];
  constraints: RuntimeConstraints;
  request: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; model?: string; maxTokens?: number };
}

export interface PolicyResult {
  eligible: ProviderAdapter[];
  excluded: Exclusion[];
  rationale: string[];
}

/**
 * Hard filters. local-only drops every cloud adapter here, before ranking,
 * so fallback cannot rediscover them.
 */
export function applyPolicy(input: PolicyInput): PolicyResult {
  const { adapters, constraints } = input;
  const excluded: Exclusion[] = [];
  const rationale: string[] = [];
  const req = completionFrom(input.request);

  if (constraints.privacy === 'local-only') {
    rationale.push('privacy=local-only is a hard constraint: cloud adapters are ineligible.');
  }

  const eligible: ProviderAdapter[] = [];
  for (const adapter of adapters) {
    const why = excludeReason(adapter, constraints, req);
    if (why) {
      excluded.push({ id: adapter.id, reason: why });
    } else {
      eligible.push(adapter);
    }
  }

  if (constraints.allowedProviders && constraints.allowedProviders.length > 0) {
    rationale.push(`allowedProviders=${constraints.allowedProviders.join(',')}.`);
  }
  if (constraints.capabilities && constraints.capabilities.length > 0) {
    rationale.push(`required capabilities: ${constraints.capabilities.join(', ')}.`);
  }

  return { eligible, excluded, rationale };
}

function excludeReason(
  adapter: ProviderAdapter,
  constraints: RuntimeConstraints,
  req: ReturnType<typeof completionFrom>,
): string | null {
  if (!adapter.configured()) {
    return 'not configured';
  }
  if (constraints.privacy === 'local-only' && adapter.residency !== 'local') {
    return 'privacy=local-only forbids cloud execution';
  }
  if (constraints.allowedProviders && constraints.allowedProviders.length > 0) {
    if (!constraints.allowedProviders.includes(adapter.id)) {
      return `not in allowedProviders (${constraints.allowedProviders.join(', ')})`;
    }
  }
  if (constraints.capabilities && constraints.capabilities.length > 0) {
    const missing = constraints.capabilities.filter((c) => !adapter.capabilities.includes(c));
    if (missing.length > 0) {
      return `missing capabilities: ${missing.join(', ')}`;
    }
  }
  const usd = estimateCostUsd(adapter, req);
  if (costConstraintApplies(constraints, usd)) {
    return `estimated $${usd!.toFixed(6)} exceeds maxCostUsd ${constraints.maxCostUsd} (catalog ${catalogModelId(adapter, req.model)})`;
  }
  const lat = heuristicLatencyMs(adapter);
  if (latencyConstraintApplies(constraints, lat)) {
    return `latency class ${adapter.latencyClass} (~${lat}ms) exceeds maxLatencyMs ${constraints.maxLatencyMs}`;
  }
  return null;
}

export function byIdMap(adapters: ProviderAdapter[]): Map<AdapterId, ProviderAdapter> {
  return new Map(adapters.map((a) => [a.id, a]));
}
