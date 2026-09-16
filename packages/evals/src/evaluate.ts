import { byId, costOfCall, estimate, type Estimate } from '@ark/core';

export interface EvalInput {
  text: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  finishReason: 'stop' | 'length' | 'error';
  maxLatencyMs?: number;
  maxCostUsd?: number;
  expected?: {
    contains?: string;
    equals?: string;
  };
}

export interface Check {
  name: 'quality' | 'latency' | 'cost' | 'reliability';
  pass: boolean;
  detail: string;
  estimate: Estimate<number | boolean | string>;
}

export interface EvalReport {
  quality: Check;
  latency: Check;
  cost: Check;
  reliability: Check;
  pass: boolean;
}

function costEstimate(modelId: string, inputTokens: number, outputTokens: number): Estimate<number> {
  const model = byId(modelId);
  if (!model) {
    return estimate(0, 'heuristic', `model ${modelId} is not in the catalog — unpriced`);
  }
  const usd = costOfCall(model, { inputTokens, outputTokens });
  return estimate(usd, 'benchmark', `catalog ${model.id} asOf ${model.asOf}`);
}

/**
 * Score one completed call. No model-as-judge: quality is string equality /
 * substring, or "no oracle" when the caller did not supply an expected value.
 */
export function evaluate(input: EvalInput): EvalReport {
  const quality = qualityCheck(input);
  const latency: Check = {
    name: 'latency',
    pass: input.maxLatencyMs === undefined || input.latencyMs <= input.maxLatencyMs,
    detail:
      input.maxLatencyMs === undefined
        ? `observed ${input.latencyMs}ms (no budget)`
        : `observed ${input.latencyMs}ms vs budget ${input.maxLatencyMs}ms`,
    estimate: estimate(input.latencyMs, 'measured', 'wall clock around provider complete()'),
  };
  const costEst = costEstimate(input.modelId, input.inputTokens, input.outputTokens);
  const cost: Check = {
    name: 'cost',
    pass: input.maxCostUsd === undefined || costEst.basis === 'heuristic' || costEst.value <= input.maxCostUsd,
    detail:
      costEst.basis === 'heuristic'
        ? costEst.source
        : input.maxCostUsd === undefined
          ? `$${costEst.value} (no ceiling)`
          : `$${costEst.value} vs ceiling $${input.maxCostUsd}`,
    estimate: costEst,
  };
  const reliability: Check = {
    name: 'reliability',
    pass: input.finishReason !== 'error' && input.text.trim().length > 0,
    detail: `finishReason=${input.finishReason}, empty=${input.text.trim().length === 0}`,
    estimate: estimate(input.finishReason !== 'error', 'measured', 'provider finish reason and non-empty text'),
  };
  return {
    quality,
    latency,
    cost,
    reliability,
    pass: quality.pass && latency.pass && cost.pass && reliability.pass,
  };
}

function qualityCheck(input: EvalInput): Check {
  if (input.expected?.equals !== undefined) {
    const pass = input.text === input.expected.equals;
    return {
      name: 'quality',
      pass,
      detail: pass ? 'exact match' : 'exact match failed',
      estimate: estimate(pass, 'measured', 'exact string comparison against caller-supplied oracle'),
    };
  }
  if (input.expected?.contains !== undefined) {
    const pass = input.text.includes(input.expected.contains);
    return {
      name: 'quality',
      pass,
      detail: pass ? 'substring present' : `missing ${JSON.stringify(input.expected.contains)}`,
      estimate: estimate(pass, 'measured', 'substring comparison against caller-supplied oracle'),
    };
  }
  return {
    name: 'quality',
    pass: true,
    detail: 'no oracle — quality not scored',
    estimate: estimate(true, 'heuristic', 'no expected output supplied; quality is unscored rather than guessed'),
  };
}
