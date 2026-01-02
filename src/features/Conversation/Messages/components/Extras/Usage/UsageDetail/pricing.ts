import { type ModelPriceCurrency, type Pricing } from 'model-bank';

import {
  formatPriceByCurrency,
  getCachedTextInputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
  getWriteCacheInputUnitRate,
} from '@/utils/index';

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
