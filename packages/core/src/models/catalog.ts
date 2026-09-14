/**
 * Model catalog.
 *
 * Prices verified against vendor and aggregator sources on 2026-09-14 and
 * stamped with `asOf`. They WILL go stale — several entries below are
 * explicitly promotional and dated. `staleEntries()` exists so the UI can nag
 * rather than quietly serving old numbers as fact.
 *
 * Run `npm run refresh:models` (scripts/refresh-models.ts) to re-verify.
 */

export type Provider = 'anthropic' | 'openai' | 'google' | 'local' | 'bedrock';

/** Capability tier. The routing engine reasons in tiers, not model names. */
export type Tier = 'nano' | 'small' | 'mid' | 'frontier';

export type Capability =
  | 'text' | 'vision' | 'audio' | 'structured_output'
  | 'tool_use' | 'long_context' | 'reasoning' | 'batch' | 'caching';

export interface ModelEntry {
  id: string;
  provider: Provider;
  displayName: string;
  tier: Tier;
  /** USD per 1M tokens. */
  inputPer1M: number;
  outputPer1M: number;
  /** Cache reads typically bill at 10% of input across the major providers. */
  cachedInputPer1M?: number;
  contextWindow: number;
  capabilities: Capability[];
  latencyClass: 'fast' | 'standard' | 'slow';
  /** ISO date this pricing was verified. */
  asOf: string;
  /** Set when the rate is promotional and scheduled to change. */
  priceExpiresOn?: string;
  notes?: string;
}

export const CATALOG: ModelEntry[] = [
  // ---- Anthropic (verified 2026-09-14) ----
  {
    id: 'claude-fable-5.1', provider: 'anthropic', displayName: 'Claude Fable 5.1', tier: 'frontier',
    inputPer1M: 10, outputPer1M: 50, cachedInputPer1M: 0.25, contextWindow: 200_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'reasoning', 'long_context', 'batch', 'caching'],
    latencyClass: 'slow', asOf: '2026-09-14',
  },
  {
    id: 'claude-opus-5', provider: 'anthropic', displayName: 'Claude Opus 5', tier: 'frontier',
    inputPer1M: 5, outputPer1M: 25, cachedInputPer1M: 0.5, contextWindow: 200_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'reasoning', 'long_context', 'batch', 'caching'],
    latencyClass: 'slow', asOf: '2026-09-14',
  },
  {
    id: 'claude-sonnet-5', provider: 'anthropic', displayName: 'Claude Sonnet 5', tier: 'mid',
    inputPer1M: 2, outputPer1M: 10, cachedInputPer1M: 0.2, contextWindow: 200_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'reasoning', 'long_context', 'batch', 'caching'],
    latencyClass: 'standard', asOf: '2026-09-14',
    notes: 'Launch introductory rate became the standard rate; the scheduled $3/$15 increase was cancelled.',
  },
  {
    id: 'claude-haiku-4.5', provider: 'anthropic', displayName: 'Claude Haiku 4.5', tier: 'small',
    inputPer1M: 1, outputPer1M: 5, cachedInputPer1M: 0.1, contextWindow: 200_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'batch', 'caching'],
    latencyClass: 'fast', asOf: '2026-09-14',
  },

  // ---- OpenAI (verified 2026-09-14) ----
  {
    id: 'gpt-6-astra', provider: 'openai', displayName: 'GPT-6 Astra', tier: 'frontier',
    inputPer1M: 10, outputPer1M: 50, cachedInputPer1M: 1, contextWindow: 400_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'reasoning', 'long_context', 'batch', 'caching'],
    latencyClass: 'slow', asOf: '2026-09-14', notes: 'Released 2026-09-03.',
  },
  {
    id: 'gpt-5.6-sol', provider: 'openai', displayName: 'GPT-5.6 Sol', tier: 'frontier',
    inputPer1M: 4, outputPer1M: 20, cachedInputPer1M: 0.4, contextWindow: 400_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'reasoning', 'long_context', 'batch', 'caching'],
    latencyClass: 'slow', asOf: '2026-09-14', priceExpiresOn: '2026-11-21',
    notes: 'Promotional rate through at least 2026-11-21.',
  },
  {
    id: 'gpt-5.6-terra', provider: 'openai', displayName: 'GPT-5.6 Terra', tier: 'mid',
    inputPer1M: 2, outputPer1M: 12, cachedInputPer1M: 0.2, contextWindow: 400_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'long_context', 'batch', 'caching'],
    latencyClass: 'standard', asOf: '2026-09-14',
  },
  {
    id: 'gpt-5.6-luna', provider: 'openai', displayName: 'GPT-5.6 Luna', tier: 'small',
    inputPer1M: 0.2, outputPer1M: 1.2, cachedInputPer1M: 0.02, contextWindow: 200_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'batch', 'caching'],
    latencyClass: 'fast', asOf: '2026-09-14',
  },
  {
    id: 'gpt-5-nano', provider: 'openai', displayName: 'GPT-5 nano', tier: 'nano',
    inputPer1M: 0.05, outputPer1M: 0.4, cachedInputPer1M: 0.005, contextWindow: 128_000,
    capabilities: ['text', 'structured_output', 'batch', 'caching'],
    latencyClass: 'fast', asOf: '2026-09-14', notes: 'Cheapest listed OpenAI model.',
  },

  // ---- Google (verified 2026-09-14) ----
  {
    id: 'gemini-3.1-pro', provider: 'google', displayName: 'Gemini 3.1 Pro', tier: 'frontier',
    inputPer1M: 2, outputPer1M: 12, cachedInputPer1M: 0.2, contextWindow: 200_000,
    capabilities: ['text', 'vision', 'audio', 'structured_output', 'tool_use', 'reasoning', 'long_context', 'batch', 'caching'],
    latencyClass: 'standard', asOf: '2026-09-14',
    notes: 'Above a 200K-token prompt, input doubles and output rises ~50%.',
  },
  {
    id: 'gemini-3.8-flash', provider: 'google', displayName: 'Gemini 3.8 Flash', tier: 'mid',
    inputPer1M: 0.75, outputPer1M: 3.75, cachedInputPer1M: 0.075, contextWindow: 1_000_000,
    capabilities: ['text', 'vision', 'audio', 'structured_output', 'tool_use', 'long_context', 'batch', 'caching'],
    latencyClass: 'fast', asOf: '2026-09-14', priceExpiresOn: '2026-12-31',
    notes: 'Promotional through 2026-12-31; doubles to $1.50/$7.50 on 2027-01-01.',
  },
  {
    id: 'gemini-3.1-flash-lite', provider: 'google', displayName: 'Gemini 3.1 Flash-Lite', tier: 'small',
    inputPer1M: 0.25, outputPer1M: 1.5, cachedInputPer1M: 0.025, contextWindow: 1_000_000,
    capabilities: ['text', 'vision', 'structured_output', 'tool_use', 'long_context', 'batch', 'caching'],
    latencyClass: 'fast', asOf: '2026-09-14',
    notes: 'Undercuts the newer 3.5 Flash-Lite at $0.30/$2.50.',
  },

  // ---- Local / open-weight ----
  // Priced by amortized hardware + power, not per token. See economics/local.ts
  // for the derivation. These are the entries that make the hybrid question
  // answerable instead of ideological.
  {
    id: 'local-8b', provider: 'local', displayName: 'Open-weight 8B (local)', tier: 'small',
    inputPer1M: 0.04, outputPer1M: 0.04, contextWindow: 128_000,
    capabilities: ['text', 'structured_output'],
    latencyClass: 'fast', asOf: '2026-09-14',
    notes: 'Amortized: workstation GPU at 60% utilization over 36 months + power. Marginal cost only; excludes your time.',
  },
  {
    id: 'local-14b', provider: 'local', displayName: 'Open-weight 14B (local)', tier: 'small',
    inputPer1M: 0.07, outputPer1M: 0.07, contextWindow: 128_000,
    capabilities: ['text', 'structured_output', 'tool_use'],
    latencyClass: 'standard', asOf: '2026-09-14',
  },
  {
    id: 'local-70b', provider: 'local', displayName: 'Open-weight 70B (local)', tier: 'mid',
    inputPer1M: 0.31, outputPer1M: 0.31, contextWindow: 128_000,
    capabilities: ['text', 'structured_output', 'tool_use', 'vision'],
    latencyClass: 'slow', asOf: '2026-09-14',
    notes: 'Needs multi-GPU or a large unified-memory machine. Capital cost is real; check payback before believing this is cheap.',
  },
];

export const byId = (id: string): ModelEntry | undefined => CATALOG.find((m) => m.id === id);

export const byTier = (tier: Tier): ModelEntry[] => CATALOG.filter((m) => m.tier === tier);

export const TIER_ORDER: Tier[] = ['nano', 'small', 'mid', 'frontier'];

export function tierRank(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}

/** Entries whose promotional price has lapsed, or that are older than maxAgeDays. */
export function staleEntries(now = new Date(), maxAgeDays = 45): ModelEntry[] {
  return CATALOG.filter((m) => {
    if (m.priceExpiresOn && new Date(m.priceExpiresOn) < now) return true;
    const ageDays = (now.getTime() - new Date(m.asOf).getTime()) / 86_400_000;
    return ageDays > maxAgeDays;
  });
}

/** Cheapest model in a tier that satisfies every required capability. */
export function cheapestMeeting(
  tier: Tier,
  required: Capability[],
  opts: { excludeProviders?: Provider[]; minContext?: number } = {},
): ModelEntry | undefined {
  return CATALOG
    .filter((m) => m.tier === tier)
    .filter((m) => !opts.excludeProviders?.includes(m.provider))
    .filter((m) => (opts.minContext ? m.contextWindow >= opts.minContext : true))
    .filter((m) => required.every((c) => m.capabilities.includes(c)))
    .sort((a, b) => blendedRate(a) - blendedRate(b))[0];
}

/** A 3:1 input:output blend — a reasonable default shape for most workloads. */
export function blendedRate(m: ModelEntry): number {
  return m.inputPer1M * 0.75 + m.outputPer1M * 0.25;
}
