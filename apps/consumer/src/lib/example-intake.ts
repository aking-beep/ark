/**
 * A deterministic lookup/calculate task so "See an example" shows the
 * not-ai verdict without a demo API or anything stored.
 */
export const EXAMPLE_INTAKE = {
  id: 'example',
  name: "Look up this month's invoice total",
  description: 'Add the line items and return the exact figure from the ledger.',
  task: ['calculate', 'lookup'] as Array<'calculate' | 'lookup'>,
  needsExactAnswer: true,
  harmIfWrong: 'serious' as const,
  needsCurrentInfo: true,
  doesSomething: false,
  timesPerMonth: 80,
  involvesPersonalData: false,
  involvesMoneyOrLegal: true,
};
