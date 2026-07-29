import type { LobeDefaultAiModelListItem, Pricing } from 'model-bank';

import type { ModelPricingContext } from '../types';

interface BusinessModelConfigModule {
  loadModels: (options?: {
    pricingContext?: ModelPricingContext;
  }) => Promise<LobeDefaultAiModelListItem[]>;
}

/**
 * 1. First try to get pricing from the specified provider
 * 2. If not found, try to get pricing from other providers with the same model name
 *
 * TODO: Add a fallback provider priority list. When no provider is specified,
 * first try official providers, then other providers. Same applies to getFallbackModelProperty
 */
export async function getModelPricing(
  model: string,
  provider?: string,
  pricingContext?: ModelPricingContext,
): Promise<Pricing | undefined> {
  const { loadModels } =
    (await import('@lobechat/business-model-bank/model-config')) as BusinessModelConfigModule;
  const models = await loadModels(pricingContext ? { pricingContext } : undefined);

  // 1. First try to get pricing from the specified provider
  if (provider) {
    const exactMatch = models.find((m) => m.id === model && m.providerId === provider);

    if (exactMatch?.pricing) {
      return exactMatch.pricing;
    }
  }

  // 2. If not found, try to get pricing from other providers with the same model name
  const fallbackMatch = models.find((m) => m.id === model);

  if (fallbackMatch?.pricing) {
    return fallbackMatch.pricing;
  }

  // 3. Return undefined if no pricing information is found
  return undefined;
}
