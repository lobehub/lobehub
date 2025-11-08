import type { ModelUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';

import { computeChatCost } from './computeChatCost';
import type { ComputeChatCostOptions } from './computeChatCost';

export const withUsageCost = (
  usage: ModelUsage,
  pricing?: Pricing,
  options?: ComputeChatCostOptions,
): ModelUsage => {
  if (!pricing) return usage;

  const pricingResult = computeChatCost(pricing, usage, options);
  if (!pricingResult) return usage;

  return { ...usage, cost: pricingResult.totalCost };
};
