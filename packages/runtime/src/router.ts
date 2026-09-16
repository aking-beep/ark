import type { AdapterId, ProviderAdapter } from '@ark/providers';
import { ADAPTER_IDS } from '@ark/providers';
import type { RouteDecision, RuntimeConstraints } from './types.js';
import { applyPolicy } from './policy.js';
import { estimateCostUsd, hintAdapter, heuristicLatencyMs, completionFrom } from './catalog.js';

const ID_RANK: Record<AdapterId, number> = {
  ollama: 0,
  bedrock: 1,
  'openai-compatible': 2,
};

export interface RouteInput {
  adapters: ProviderAdapter[];
  constraints: RuntimeConstraints;
  request: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; model?: string; maxTokens?: number };
  maxFallbacks: number;
}

/**
 * Deterministic rank of policy-eligible adapters. Same inputs → same order,
 * with a rationale string for every decision.
 */
export function route(input: RouteInput): RouteDecision {
  const policy = applyPolicy(input);
  const rationale = [...policy.rationale];
  const req = completionFrom(input.request);

  const scored = policy.eligible.map((adapter) => {
    const usd = estimateCostUsd(adapter, req);
    return {
      adapter,
      usd: usd ?? Number.POSITIVE_INFINITY,
      knownCost: usd !== null,
      latency: heuristicLatencyMs(adapter),
      idRank: ID_RANK[adapter.id],
    };
  });

  scored.sort((a, b) => {
    if (a.usd !== b.usd) return a.usd - b.usd;
    if (a.latency !== b.latency) return a.latency - b.latency;
    return a.idRank - b.idRank;
  });

  const hinted = hintAdapter(input.request.model);
  if (hinted && scored.some((s) => s.adapter.id === hinted)) {
    const idx = scored.findIndex((s) => s.adapter.id === hinted);
    if (idx > 0) {
      const [picked] = scored.splice(idx, 1);
      scored.unshift(picked!);
      rationale.push(`model hint ${input.request.model} prefers ${hinted}; that adapter is eligible so it is selected first.`);
    }
  }

  if (scored.length > 0) {
    const top = scored[0]!;
    const costBit = top.knownCost ? `estimated $${top.usd.toFixed(6)}` : 'cost unknown (not in catalog)';
    rationale.push(
      `ranked remaining adapters by estimated USD, then latency class, then id (${ADAPTER_IDS.join(' < ')}).`,
    );
    rationale.push(
      `selected ${top.adapter.id} (${top.adapter.residency}, ${top.adapter.latencyClass}, ${costBit}).`,
    );
  } else {
    rationale.push('no eligible adapter remains after policy.');
  }

  const ordered = scored.map((s) => s.adapter.id);
  const selected = ordered[0] ?? null;
  const fallbacks = selected ? ordered.slice(1, 1 + input.maxFallbacks) : [];
  if (fallbacks.length > 0) {
    rationale.push(`fallback chain (maxFallbacks=${input.maxFallbacks}): ${fallbacks.join(' → ')}.`);
  } else if (selected) {
    rationale.push(`no fallback (${input.maxFallbacks === 0 ? 'maxFallbacks=0' : 'no other eligible adapter'}).`);
  }

  return {
    selected,
    fallbacks,
    eligible: ordered,
    excluded: policy.excluded,
    rationale,
    basis: 'heuristic',
    source: 'runtime router v0.1 — deterministic policy filters then cost/latency/id rank',
  };
}
