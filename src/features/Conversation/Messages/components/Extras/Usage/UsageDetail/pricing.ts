import { type ModelPriceCurrency, type Pricing } from 'model-bank';

import {
  formatPriceByCurrency,
  getCachedTextInputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
  getWriteCacheInputUnitRate,
} from '@/utils/index';

import { formatUsdDigits, getUsdDigits } from './usd';

export const getPrice = (pricing: Pricing) => {
  const inputRate = getTextInputUnitRate(pricing);
  const outputRate = getTextOutputUnitRate(pricing);
  const cachedInputRate = getCachedTextInputUnitRate(pricing);
  const writeCacheInputRate = getWriteCacheInputUnitRate(pricing);

  const inputPrice = inputRate
    ? formatPriceByCurrency(inputRate, pricing?.currency as ModelPriceCurrency)
    : '0';
  const cachedInputPrice = cachedInputRate
    ? formatPriceByCurrency(cachedInputRate, pricing?.currency as ModelPriceCurrency)
    : '0';
  const writeCacheInputPrice = writeCacheInputRate
    ? formatPriceByCurrency(writeCacheInputRate, pricing?.currency as ModelPriceCurrency)
    : '0';
  const outputPrice = outputRate
    ? formatPriceByCurrency(outputRate, pricing?.currency as ModelPriceCurrency)
    : '0';

  return {
    cachedInput: Number(cachedInputPrice),
    input: Number(inputPrice),
    output: Number(outputPrice),
    writeCacheInput: Number(writeCacheInputPrice),
  };
};

export interface PriceLabel {
  /**
   * The amount alone (`3.00`), for copy that already carries the `$`. Absent when the
   * model does not quote the rate, so that copy is not rendered as `$--`.
   */
  amount?: string;
  /** The amount as shown in the row (`$3.00`). */
  text: string;
}

export interface PriceLabels {
  /** Present only when the model quotes a cached-input rate. */
  cachedInput?: PriceLabel;
  input: PriceLabel;
  output: PriceLabel;
  /** Present only when the model quotes a cache-write rate. */
  writeCacheInput?: PriceLabel;
}

/**
 * The per-1M-token rates a model card shows, all written with the same decimals
 * (`$0.075` and `$0.300`, not `$0.075` and `$0.3`). A rate the model does not quote
 * reads `--`: it is unknown, not free.
 */
export const getPriceLabels = (pricing?: Pricing): PriceLabels => {
  const prices = getPrice(pricing || { units: [] });
  const rates = {
    cachedInput: getCachedTextInputUnitRate(pricing),
    input: getTextInputUnitRate(pricing),
    output: getTextOutputUnitRate(pricing),
    writeCacheInput: getWriteCacheInputUnitRate(pricing),
  };
  const digits = getUsdDigits(Object.values(prices));

  const label = (key: keyof typeof rates): PriceLabel => {
    if (rates[key] === undefined) return { text: '--' };

    return {
      amount: formatUsdDigits(prices[key], digits, { withSymbol: false }),
      text: formatUsdDigits(prices[key], digits),
    };
  };

  return {
    cachedInput: rates.cachedInput ? label('cachedInput') : undefined,
    input: label('input'),
    output: label('output'),
    writeCacheInput: rates.writeCacheInput ? label('writeCacheInput') : undefined,
  };
};
