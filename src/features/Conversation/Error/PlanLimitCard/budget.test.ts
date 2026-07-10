import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getBudgetContextFromErrorBody, getNextUpgradePlan, isKnownPlan } from './budget';

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
    expect(getNextUpgradePlan(undefined)).toBeUndefined();
  });

  it('should detect known plan ids', () => {
    expect(isKnownPlan(Plans.Free)).toBe(true);
    expect(isKnownPlan(Plans.Hobby)).toBe(true);
    expect(isKnownPlan('legacy')).toBe(false);
    expect(isKnownPlan(undefined)).toBe(false);
  });
});
