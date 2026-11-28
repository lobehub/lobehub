import type { Pricing } from './types';

/**
 * Ceiling for a model's compression window when its pricing has no long-context tier. A 1M card
 * would otherwise compress only past 500k, so every turn of a long chat resends that much input.
 */
export const DEFAULT_COMPRESSION_WINDOW_TOKENS = 200_000;

/** The first finite `upTo` of tiered text-input pricing, where the long-context rate starts. */
const readFirstInputTierLimit = (pricing: Pricing | undefined): number | undefined => {
  const unit = pricing?.units.find((item) => item.name === 'textInput');
  if (unit?.strategy !== 'tiered') return;

  const limit = unit.tiers[0]?.upTo;
  return typeof limit === 'number' && limit > 0 ? limit : undefined;
};

/**
 * Context window that context compression budgets against.
 *
 * Use when:
 * - Picking `maxWindowToken` for an agent run's compression config.
 *
 * Expects:
 * - `contextWindowTokens` is the card's hard limit, which stays the request ceiling.
 *
 * Returns:
 * - The hard limit capped by the first text-input pricing tier (e.g. GPT-5.5's 272k, Gemini 3.1
 *   Pro's 200k), so a run stays on the base rate; without such a tier, capped at
 *   {@link DEFAULT_COMPRESSION_WINDOW_TOKENS}.
 * - `undefined` when the card has no hard limit.
 */
export const resolveCompressionWindowTokens = ({
  contextWindowTokens,
  pricing,
}: {
  contextWindowTokens?: number;
  pricing?: Pricing;
}): number | undefined => {
  if (!contextWindowTokens) return;

  const cap = readFirstInputTierLimit(pricing) ?? DEFAULT_COMPRESSION_WINDOW_TOKENS;
  return Math.min(contextWindowTokens, cap);
};
