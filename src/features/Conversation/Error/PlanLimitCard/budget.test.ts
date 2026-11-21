import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  formatCreditAmount,
  getBudgetContextFromErrorBody,
  getNextUpgradePlan,
  isKnownPlan,
} from './budget';

describe('PlanLimitCard budget helpers', () => {
  it('should extract budget context from an error body', () => {
    const context = {
      pricingBasis: 'estimated',
      requiredCredits: 2_500_000,
      shortfallCredits: 1_500_000,
    } as const;

    expect(getBudgetContextFromErrorBody({ budget: context })).toBe(context);
    expect(getBudgetContextFromErrorBody('error')).toBeUndefined();
    expect(getBudgetContextFromErrorBody(null)).toBeUndefined();
    expect(getBudgetContextFromErrorBody({})).toBeUndefined();
    expect(getBudgetContextFromErrorBody({ budget: 'oops' })).toBeUndefined();
  });

  it('should resolve the next upgrade plan', () => {
    expect(getNextUpgradePlan(Plans.Free)).toBe(Plans.Starter);
    expect(getNextUpgradePlan(Plans.Starter)).toBe(Plans.Premium);
    expect(getNextUpgradePlan(Plans.Premium)).toBe(Plans.Ultimate);
    expect(getNextUpgradePlan(Plans.Ultimate)).toBeUndefined();
    expect(getNextUpgradePlan(Plans.Hobby)).toBeUndefined();
    expect(getNextUpgradePlan(Plans.Plus)).toBe(Plans.Pro);
    expect(getNextUpgradePlan(Plans.Pro)).toBe(Plans.Max);
    expect(getNextUpgradePlan(Plans.Max)).toBeUndefined();
    expect(getNextUpgradePlan(undefined)).toBeUndefined();
  });

  it('should detect known plan ids', () => {
    expect(isKnownPlan(Plans.Free)).toBe(true);
    expect(isKnownPlan(Plans.Hobby)).toBe(true);
    expect(isKnownPlan(Plans.Max)).toBe(true);
    expect(isKnownPlan('legacy')).toBe(false);
    expect(isKnownPlan(undefined)).toBe(false);
  });
});

describe('formatCreditAmount', () => {
  it('should render tiny positive amounts as <$0.0001', () => {
    expect(formatCreditAmount(1)).toBe('<$0.0001');
    expect(formatCreditAmount(49)).toBe('<$0.0001');
  });

  it('should render 50 credits as $0.0001', () => {
    expect(formatCreditAmount(50)).toBe('$0.0001');
  });

  it('should render zero and whole amounts', () => {
    expect(formatCreditAmount(0)).toBe('$0.00');
    expect(formatCreditAmount(2_500_000)).toBe('$2.50');
  });
});
