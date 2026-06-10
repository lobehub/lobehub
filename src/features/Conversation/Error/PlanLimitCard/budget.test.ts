import { describe, expect, it } from 'vitest';

import {
  getBudgetContextFromErrorBody,
  getNextUpgradePlan,
  isFableCampaignLimitContext,
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

  it('should detect fable campaign limit context', () => {
    expect(isFableCampaignLimitContext({ modelId: 'claude-fable-5', providerId: 'lobehub' })).toBe(
      true,
    );
    expect(isFableCampaignLimitContext({ modelId: 'claude-opus-4-8', providerId: 'lobehub' })).toBe(
      false,
    );
    expect(
      isFableCampaignLimitContext({ modelId: 'claude-fable-5', providerId: 'anthropic' }),
    ).toBe(false);
    expect(isFableCampaignLimitContext(undefined)).toBe(false);
  });

  it('should resolve the next upgrade plan', () => {
    expect(getNextUpgradePlan('free')).toBe('starter');
    expect(getNextUpgradePlan('starter')).toBe('premium');
    expect(getNextUpgradePlan('premium')).toBe('ultimate');
    expect(getNextUpgradePlan('ultimate')).toBeUndefined();
    expect(getNextUpgradePlan('hobby')).toBeUndefined();
    expect(getNextUpgradePlan(undefined)).toBeUndefined();
  });
});
