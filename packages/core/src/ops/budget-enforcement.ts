/**
 * What a budget does once spend is already at or above the ceiling.
 *
 * observe/warn only alert — they never refuse traffic. throttle still records
 * the event (the spend happened) and tells the caller to back off. block
 * refuses the write. Deciding that from current spend, not from the batch
 * about to land, is deliberate: the first event that crosses the line is
 * still observed; the next one is not.
 */
export type BudgetEnforcement = 'observe' | 'warn' | 'throttle' | 'block';
export type BudgetAction = 'allow' | 'throttle' | 'block';

export function budgetAction(
  spentUsd: number,
  limitUsd: number,
  enforcement: BudgetEnforcement,
): BudgetAction {
  if (!(limitUsd > 0) || spentUsd < limitUsd) return 'allow';
  if (enforcement === 'block') return 'block';
  if (enforcement === 'throttle') return 'throttle';
  return 'allow';
}

/** Most restrictive of several budgets (org + workload) wins. */
export function strictestAction(actions: BudgetAction[]): BudgetAction {
  if (actions.includes('block')) return 'block';
  if (actions.includes('throttle')) return 'throttle';
  return 'allow';
}
