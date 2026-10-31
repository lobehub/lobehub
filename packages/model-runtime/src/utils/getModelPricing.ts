import type {
  LobeDefaultAiModelListItem,
  ModelParamsSchema,
  Pricing,
  TTSModelParamsSchema,
  VideoModelParamsSchema,
} from 'model-bank';

import type { ModelPricingContext } from '../types';

interface BusinessModelConfigModule {
  loadModels: (options?: {
    pricingContext?: ModelPricingContext;
  }) => Promise<LobeDefaultAiModelListItem[]>;
}

/**
 * Find the model card that prices `model`:
 * 1. First try the specified provider
 * 2. If not found, try other providers with the same model name
 *
 * TODO: Add a fallback provider priority list. When no provider is specified,
 * first try official providers, then other providers. Same applies to getFallbackModelProperty
 */
const findModelCard = async (
  model: string,
  provider: string | undefined,
  pricingContext: ModelPricingContext | undefined,
  hasProperty: (card: LobeDefaultAiModelListItem) => boolean,
): Promise<LobeDefaultAiModelListItem | undefined> => {
  const { loadModels } =
    (await import('@lobechat/business-model-bank/model-config')) as BusinessModelConfigModule;
  const models = await loadModels(pricingContext ? { pricingContext } : undefined);

  if (provider) {
    const exactMatch = models.find((m) => m.id === model && m.providerId === provider);
    if (exactMatch && hasProperty(exactMatch)) return exactMatch;
  }

  const fallbackMatch = models.find((m) => m.id === model);
  return fallbackMatch && hasProperty(fallbackMatch) ? fallbackMatch : undefined;
};

export type ModelPricingResolver = (
  model: string,
  pricingContext?: ModelPricingContext,
) => Pricing | undefined | Promise<Pricing | undefined>;

const pricingResolvers = new Map<string, ModelPricingResolver>();

/**
 * A provider whose prices are read live rather than from the model bank answers for its own models.
 * Its answer is final: another provider's card with the same model id never prices them.
 * Returns a function that removes the resolver.
 */
export const registerModelPricingResolver = (provider: string, resolver: ModelPricingResolver) => {
  pricingResolvers.set(provider, resolver);
  return () => {
    if (pricingResolvers.get(provider) === resolver) pricingResolvers.delete(provider);
  };
};

export async function getModelPricing(
  model: string,
  provider?: string,
  pricingContext?: ModelPricingContext,
): Promise<Pricing | undefined> {
  const resolver = provider ? pricingResolvers.get(provider) : undefined;
  if (resolver) return resolver(model, pricingContext);

  const card = await findModelCard(model, provider, pricingContext, (m) => !!m.pricing);
  return card?.pricing;
}

/**
 * Parameter schema of a generation model card, resolved like {@link getModelPricing} so the
 * defaults used for a request come from the same card that prices it.
 */
export async function getModelParameters(
  model: string,
  provider?: string,
  pricingContext?: ModelPricingContext,
): Promise<ModelParamsSchema | TTSModelParamsSchema | VideoModelParamsSchema | undefined> {
  const card = await findModelCard(
    model,
    provider,
    pricingContext,
    (m) => 'parameters' in m && !!m.parameters,
  );
  return card && 'parameters' in card ? card.parameters : undefined;
}
