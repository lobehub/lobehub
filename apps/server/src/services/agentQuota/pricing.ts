import type { QuotaModelPrice } from '@lobechat/heterogeneous-agents/quota';
import anthropicModels from 'model-bank/anthropic';

/**
 * $ per million tokens for a Claude model, from the model bank. The bank lists
 * the base input/output rates plus the cache-read and 5-minute cache-write
 * rates; the 1-hour write rate is derived inside `computeTurnCostUsd` (2x base
 * input) when not provided. Returns null for models the bank doesn't know —
 * the caller should then store the tokens without a computed cost rather than
 * guess a price.
 */
export const claudeModelPrice = (modelId: string): QuotaModelPrice | null => {
  const model = anthropicModels.find((m) => m.id === modelId);
  const units = model?.pricing?.units;
  if (!units) return null;

  const rate = (name: string) => {
    const unit = units.find((u) => u.name === name && u.unit === 'millionTokens');
    return unit && 'rate' in unit ? unit.rate : undefined;
  };

  const input = rate('textInput');
  const output = rate('textOutput');
  if (input === undefined || output === undefined) return null;

  return {
    cacheRead: rate('textInput_cacheRead'),
    cacheWrite5m: rate('textInput_cacheWrite'),
    input,
    output,
  };
};
