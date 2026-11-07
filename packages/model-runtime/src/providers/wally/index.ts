import { ModelProvider, wally as wallyChatModels } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processModelList } from '../../utils/modelParse';

export interface WallyModelCard {
  context_length?: number;
  description?: string;
  id: string;
  input_modalities?: string[];
  max_output_tokens?: number;
  name?: string;
  pricing?: {
    completion?: string;
    input_cache_read?: string;
    prompt?: string;
  };
  supported_features?: string[];
}

const toPerMillion = (price?: string) => {
  if (price === undefined || price === null || price === '') return undefined;
  const value = Number(price);
  return Number.isFinite(value) ? Number((value * 1_000_000).toPrecision(10)) : undefined;
};

export const params = {
  baseURL: 'https://inference.runanywhere.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_WALLY_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: WallyModelCard[] = modelsPage.data ?? [];

    const standardModelList = modelList.map((model) => {
      const pricing = {
        cachedInput: toPerMillion(model.pricing?.input_cache_read),
        input: toPerMillion(model.pricing?.prompt),
        output: toPerMillion(model.pricing?.completion),
      };
      const hasRemotePricing = Object.values(pricing).some((rate) => rate !== undefined);

      return {
        contextWindowTokens: model.context_length,
        description: model.description,
        displayName: model.name,
        functionCall: model.supported_features?.includes('tools'),
        id: model.id,
        maxOutput: model.max_output_tokens,
        // The live list carries prices; fall back to the Wally card when it does not
        pricing: hasRemotePricing
          ? pricing
          : wallyChatModels.find((card) => card.id === model.id)?.pricing,
        reasoning: model.supported_features?.includes('reasoning'),
        vision: model.input_modalities?.includes('image'),
      };
    });

    // Resolve against Wally's own model cards first, not another provider's card for the same id
    return processModelList(standardModelList, {}, 'wally');
  },
  provider: ModelProvider.Wally,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeWallyAI = createOpenAICompatibleRuntime(params);
