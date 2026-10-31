import type { AiModelType, Pricing, PricingUnitName } from 'model-bank';

import { formatPriceByCurrency } from '@/utils/format';
import {
  getAudioInputUnitRate,
  getAudioOutputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
} from '@/utils/pricing';

type Translate = (key: string, options: { amount: string }) => string;

const findUnit = (pricing: Pricing, name: PricingUnitName) =>
  pricing.units?.find((unit) => unit.name === name);

const formatTTSPricing = (pricing: Pricing, t: Translate): (string | false)[] => {
  const format = (rate: number) => formatPriceByCurrency(rate, pricing.currency);

  // TTS bills the input text, per million characters (tts-1, MiniMax speech) or per
  // million tokens (gpt-4o-mini-tts, which also bills the generated audio tokens).
  const textInputRate = getTextInputUnitRate(pricing);
  if (typeof textInputRate === 'number') {
    const audioOutputRate = getAudioOutputUnitRate(pricing);
    const charBased = findUnit(pricing, 'textInput')?.unit === 'millionCharacters';

    return [
      t(
        charBased
          ? 'providerModels.item.pricing.inputCharts'
          : 'providerModels.item.pricing.inputTokens',
        { amount: format(textInputRate) },
      ),
      typeof audioOutputRate === 'number' &&
        t('providerModels.item.pricing.audioOutputTokens', { amount: format(audioOutputRate) }),
    ];
  }

  // Legacy custom models stored their per-character price as audioInput.
  const legacyRate = getAudioInputUnitRate(pricing);
  return [
    typeof legacyRate === 'number' &&
      t('providerModels.item.pricing.inputCharts', { amount: format(legacyRate) }),
  ];
};

/**
 * Price lines shown under a model in the provider model list.
 */
export const formatModelPricingLabels = (
  type: AiModelType | undefined,
  pricing: Pricing | undefined,
  t: Translate,
): string[] => {
  if (!pricing) return [];

  const format = (rate: number) => formatPriceByCurrency(rate, pricing.currency);
  let labels: (string | false)[];

  switch (type) {
    case 'chat': {
      const inputRate = getTextInputUnitRate(pricing);
      const outputRate = getTextOutputUnitRate(pricing);
      labels = [
        typeof inputRate === 'number' &&
          t('providerModels.item.pricing.inputTokens', { amount: format(inputRate) }),
        typeof outputRate === 'number' &&
          t('providerModels.item.pricing.outputTokens', { amount: format(outputRate) }),
      ];
      break;
    }
    // Decision models bill input tokens only.
    case 'decision':
    case 'embedding': {
      const inputRate = getTextInputUnitRate(pricing);
      labels = [
        typeof inputRate === 'number' &&
          t('providerModels.item.pricing.inputTokens', { amount: format(inputRate) }),
      ];
      break;
    }
    case 'tts': {
      labels = formatTTSPricing(pricing, t);
      break;
    }
    case 'asr': {
      const inputRate = getAudioInputUnitRate(pricing);
      labels = [
        typeof inputRate === 'number' &&
          t('providerModels.item.pricing.inputMinutes', { amount: format(inputRate) }),
      ];
      break;
    }
    default: {
      labels = [];
    }
  }

  return labels.filter(Boolean) as string[];
};
