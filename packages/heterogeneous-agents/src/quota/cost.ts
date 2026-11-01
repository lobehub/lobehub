import type { QuotaModelPrice, QuotaTokenUsage } from './types';

/**
 * Anthropic's fixed cache multipliers relative to the base input rate. The
 * model-bank pricing table only lists the 5-minute cache-write rate; the 1-hour
 * write is 2x base input and cache read is 0.1x — so we derive them when the
 * caller doesn't pass exact rates.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

/**
 * Cost of one turn in USD, priced by token class. Cache-read/-write are billed
 * at their own rates (this is exactly why raw token counts are the wrong unit
 * for quota — cache read is a tenth of input, a 1h write is double it).
 *
 * `price` is $ per million tokens. Cache rates default to the fixed Anthropic
 * multipliers of `price.input`; pass explicit values to use exact model-bank
 * rates instead.
 */
export const computeTurnCostUsd = (usage: QuotaTokenUsage, price: QuotaModelPrice): number => {
  const cacheReadRate = price.cacheRead ?? price.input * CACHE_READ_MULTIPLIER;
  const cacheWrite5mRate = price.cacheWrite5m ?? price.input * CACHE_WRITE_5M_MULTIPLIER;
  const cacheWrite1hRate = price.cacheWrite1h ?? price.input * CACHE_WRITE_1H_MULTIPLIER;

  const micros =
    (usage.input ?? 0) * price.input +
    (usage.output ?? 0) * price.output +
    (usage.reasoning ?? 0) * price.output +
    (usage.cacheRead ?? 0) * cacheReadRate +
    (usage.cacheWrite5m ?? 0) * cacheWrite5mRate +
    (usage.cacheWrite1h ?? 0) * cacheWrite1hRate;

  return micros / 1e6;
};

/**
 * Total input-equivalent tokens for a turn, useful for display only. NOT a
 * quota unit — kept because the UI shows a token total alongside the USD one.
 */
export const totalTokens = (usage: QuotaTokenUsage): number =>
  (usage.input ?? 0) +
  (usage.output ?? 0) +
  (usage.reasoning ?? 0) +
  (usage.cacheRead ?? 0) +
  (usage.cacheWrite5m ?? 0) +
  (usage.cacheWrite1h ?? 0);
