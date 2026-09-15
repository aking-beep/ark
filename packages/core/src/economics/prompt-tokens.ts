import { Estimate, estimate } from '../schema/provenance.js';

/**
 * Token count from a pasted prompt.
 *
 * This is a rule of thumb, not a tokenizer. Real prompts grow once the system
 * prompt, retrieved chunks and few-shot examples are counted — which is why
 * every figure that consumes this is labelled `heuristic` until Control
 * observes the real shape. Four characters per token is the same shortcut
 * vendor calculators use for English; it is good enough to replace a slider
 * that people set by vibes, and not good enough to put in a board deck.
 */
export function estimateTokens(text: string): Estimate<number> {
  const trimmed = text.trim();
  const value = trimmed.length === 0 ? 0 : Math.max(1, Math.round(trimmed.length / 4));
  return estimate(value, 'heuristic', '4 characters ≈ 1 token — English rule of thumb, not a tokenizer');
}
