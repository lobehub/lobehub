import type { QuotaModelPrice } from '@lobechat/heterogeneous-agents/quota';
import anthropicModels from 'model-bank/anthropic';
import openaiModels from 'model-bank/openai';

/**
 * $ per million tokens for a model, from the model bank. The bank lists the
 * base input/output rates plus the cache-read rate and, for Anthropic, the
 * cache-write rate — either one flat rate or a `ttl` lookup with `5m` / `1h`
 * prices (OpenAI has no cache-write tier, so it stays undefined). Any rate the
 * bank omits is derived inside `computeTurnCostUsd` from base input. Returns
 * null for models the bank doesn't know — the caller should then store the
 * tokens without a computed cost rather than guess a price.
 */
interface BankModelCard {
  id: string;
  pricing?: {
    units?: {
      lookup?: { prices: Record<string, number> };
      name: string;
      rate?: number;
      unit: string;
    }[];
  };
}

const bankModelPrice = (
  models: readonly BankModelCard[],
  modelId: string,
): QuotaModelPrice | null => {
  const model = models.find((m) => m.id === modelId);
  const units = model?.pricing?.units;
  if (!units) return null;

  const findUnit = (name: string) =>
    units.find((u) => u.name === name && u.unit === 'millionTokens');
  const rate = (name: string) => findUnit(name)?.rate;
  const cacheWrite = findUnit('textInput_cacheWrite');

  const input = rate('textInput');
  const output = rate('textOutput');
  if (input === undefined || output === undefined) return null;

  return {
    cacheRead: rate('textInput_cacheRead'),
    cacheWrite1h: cacheWrite?.lookup?.prices['1h'],
    cacheWrite5m: cacheWrite?.lookup?.prices['5m'] ?? cacheWrite?.rate,
    input,
    output,
  };
};

export const claudeModelPrice = (modelId: string): QuotaModelPrice | null =>
  bankModelPrice(anthropicModels, modelId);

/** Codex turns run OpenAI models, priced out of the bank's openai table. */
export const codexModelPrice = (modelId: string): QuotaModelPrice | null =>
  bankModelPrice(openaiModels, modelId);
