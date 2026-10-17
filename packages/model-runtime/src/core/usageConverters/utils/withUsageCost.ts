import type { ModelUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';

import type { ComputeChatCostOptions } from './computeChatCost';
import { computeChatCost } from './computeChatCost';

const MAX_WARNED_ISSUES_PER_PRICING = 32;
const warnedIssuesByPricing = new WeakMap<Pricing, Set<string>>();

interface UsageCostContext {
  model?: string;
  provider?: string;
}

export const withUsageCost = (
  usage: ModelUsage,
  pricing?: Pricing,
  options?: ComputeChatCostOptions,
  /** Identity attached to pricing warnings so a failing card can be located. */
  context?: UsageCostContext,
): ModelUsage => {
  if (!pricing) return usage;

  const pricingResult = computeChatCost(pricing, usage, options);
  if (!pricingResult) return usage;

  if (pricingResult.issues.length > 0) {
    // Every unit that fails to resolve contributes 0 to `totalCost`, which is
    // indistinguishable from "free" once stored - surface the failure instead
    // of persisting a silently understated cost (see #16991 for the data side).
    // Warn each distinct failure once per pricing card: some cards fail
    // structurally on every call, and repeating the warning per message would
    // only bury it. Keyed by the pricing object so distinct cards sharing a
    // failure shape each warn once (WeakMap entries release with the card);
    // the per-card set is capped because failure reasons can embed
    // caller-supplied lookup values.
    let warned = warnedIssuesByPricing.get(pricing);
    if (!warned) {
      warned = new Set();
      warnedIssuesByPricing.set(pricing, warned);
    }
    const capacity = MAX_WARNED_ISSUES_PER_PRICING - warned.size;
    if (capacity > 0) {
      const freshIssues = pricingResult.issues
        .filter((issue) => !warned.has(issue.unit.name + ':' + issue.reason))
        .slice(0, capacity);
      if (freshIssues.length > 0) {
        for (const issue of freshIssues) warned.add(issue.unit.name + ':' + issue.reason);
        console.warn(
          '[withUsageCost] pricing issues, cost may be understated:',
          JSON.stringify({ context, issues: freshIssues }),
        );
      }
    }
  }

  return { ...usage, cost: pricingResult.totalCost };
};
