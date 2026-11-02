import type { OnDemandBudgetConfig } from '@lobechat/types';
import { ON_DEMAND_DEFAULT_BUDGET } from '@lobechat/types';

import { OnDemandBudgetInputError } from './budgetErrors';

const assertInteger = (value: number, field: string) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new OnDemandBudgetInputError(field, `${field} must be a non-negative integer.`);
  }
};

/**
 * Resolves the single budget configuration consumed by the on-demand planner.
 * `maxTokens` is the legacy total-only override; it never creates a hidden
 * reserve or a second per-category budget.
 */
export const resolveOnDemandBudgetConfig = (
  config?: Partial<OnDemandBudgetConfig>,
  legacyMaxTokens?: number,
): OnDemandBudgetConfig => {
  const base: OnDemandBudgetConfig =
    legacyMaxTokens === undefined
      ? ON_DEMAND_DEFAULT_BUDGET
      : {
          dynamicTokens: legacyMaxTokens,
          reserveTokens: 0,
          totalTokens: legacyMaxTokens,
        };

  const resolved: OnDemandBudgetConfig = {
    dynamicTokens: config?.dynamicTokens ?? base.dynamicTokens,
    reserveTokens: config?.reserveTokens ?? base.reserveTokens,
    totalTokens: config?.totalTokens ?? base.totalTokens,
  };

  assertInteger(resolved.totalTokens, 'budget.totalTokens');
  assertInteger(resolved.dynamicTokens, 'budget.dynamicTokens');
  assertInteger(resolved.reserveTokens, 'budget.reserveTokens');

  if (resolved.dynamicTokens + resolved.reserveTokens > resolved.totalTokens) {
    throw new OnDemandBudgetInputError(
      'budget',
      'dynamicTokens + reserveTokens must not exceed totalTokens.',
    );
  }

  return Object.freeze(resolved);
};
