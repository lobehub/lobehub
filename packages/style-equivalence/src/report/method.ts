import type { ReportCase } from './data';

export const aaSummary = (cases: ReportCase[], conditionCount: number) => ({
  checks: cases.length * conditionCount,
  unstable: cases
    .filter((entry) => entry.result.unstableConditions?.length)
    .map((entry) => ({ conditions: entry.result.unstableConditions!, key: entry.key })),
});

export const conditionScope = (labels: string[], total: number) => {
  const expected = [...new Set(labels.map((label) => label.split('#')[0]))];
  if (expected.length === total) return `全部 ${total} 种条件`;
  if (expected.length <= 3) return expected.join('、');
  return `${total} 种条件里的 ${expected.length} 种`;
};
