import type { LobeDefaultAiModelListItem, Pricing } from 'model-bank';

export interface ModelPricingContext {
  plan: string;
  scope: 'personal';
}

export interface ModelPricingOptions {
  pricingContext?: ModelPricingContext;
}

export const MODEL_PRICING_CONTEXT_METADATA_KEY = 'modelPricingContext';

interface BusinessModelConfigModule {
  loadModels: (options?: ModelPricingOptions) => Promise<LobeDefaultAiModelListItem[]>;
}

interface ModelPricingContextStorage {
  getStore: () => ModelPricingContext | undefined;
  run: <T>(
    pricingContext: ModelPricingContext | undefined,
    callback: () => T | Promise<T>,
  ) => T | Promise<T>;
}

let modelPricingContextStorage: ModelPricingContextStorage | undefined;

const getModelPricingContextStorage = async (): Promise<ModelPricingContextStorage> => {
  if (modelPricingContextStorage) return modelPricingContextStorage;

  const { AsyncLocalStorage } = await import('node:async_hooks');
  modelPricingContextStorage = new AsyncLocalStorage<ModelPricingContext | undefined>();

  return modelPricingContextStorage;
};

export const runWithModelPricingContext = async <T>(
  pricingContext: ModelPricingContext | undefined,
  callback: () => T | Promise<T>,
): Promise<T> => {
  if (!pricingContext) return callback();

  const storage = await getModelPricingContextStorage();

  return storage.run(pricingContext, callback);
};

export const getModelPricingOptionsFromMetadata = (
  metadata?: Record<string, unknown>,
): ModelPricingOptions | undefined => {
  const pricingContext = metadata?.[MODEL_PRICING_CONTEXT_METADATA_KEY];

  if (
    !pricingContext ||
    typeof pricingContext !== 'object' ||
    (pricingContext as ModelPricingContext).scope !== 'personal' ||
    typeof (pricingContext as ModelPricingContext).plan !== 'string'
  ) {
    return undefined;
  }

  return { pricingContext: pricingContext as ModelPricingContext };
};

const resolveModelPricingOptions = (
  options?: ModelPricingOptions,
): ModelPricingOptions | undefined => {
  const pricingContext = options?.pricingContext ?? modelPricingContextStorage?.getStore();

  return pricingContext ? { pricingContext } : undefined;
};

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
  options?: ModelPricingOptions,
): Promise<Pricing | undefined> {
  const { loadModels } =
    (await import('@lobechat/business-model-bank/model-config')) as BusinessModelConfigModule;
  const models = await loadModels(resolveModelPricingOptions(options));

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
