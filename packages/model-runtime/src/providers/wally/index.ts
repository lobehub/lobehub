import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

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

    const standardModelList = modelList.map((model) => ({
      contextWindowTokens: model.context_length,
      description: model.description,
      displayName: model.name,
      functionCall: model.supported_features?.includes('tools'),
      id: model.id,
      maxOutput: model.max_output_tokens,
      pricing: {
        cachedInput: toPerMillion(model.pricing?.input_cache_read),
        input: toPerMillion(model.pricing?.prompt),
        output: toPerMillion(model.pricing?.completion),
      },
      reasoning: model.supported_features?.includes('reasoning'),
      vision: model.input_modalities?.includes('image'),
    }));

    return processMultiProviderModelList(standardModelList, 'wally');
  },
  provider: ModelProvider.Wally,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeWallyAI = createOpenAICompatibleRuntime(params);
