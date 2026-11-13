interface PlanFields {
  planTier?: string | null;
  rateLimitTier?: string | null;
}

/** The rate-limit tier of the $200 plan formerly sold as Max 20x. */
const ULTRA_RATE_LIMIT_TIER = /(?:^|_)max_20x$/i;

/**
 * The plan name to show for a subscription account.
 *
 * Anthropic renamed Max 20x to Ultra on 2026-10-30 and moved existing
 * subscribers over automatically, but the account record Claude Code caches
 * still says `organizationType: claude_max` for them. Only the rate-limit tier
 * (`default_claude_max_20x` vs `default_claude_max_5x`) tells the $200 plan
 * from the $100 one, so read the plan through it. Anything else, including a
 * plan that already reports `ultra`, passes through unchanged.
 */
export const displayPlanTier = ({ planTier, rateLimitTier }: PlanFields): string | undefined => {
  if (!planTier) return undefined;
  if (planTier === 'max' && rateLimitTier && ULTRA_RATE_LIMIT_TIER.test(rateLimitTier))
    return 'ultra';
  return planTier;
};
