import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface GMICloudModelCard {
  context_length?: number;
  id: string;
  pricing?: {
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    prompt?: string;
  };
}

const toPerMillion = (price?: string) => {
  const value = Number(price);
  return value > 0 ? Number((value * 1_000_000).toFixed(6)) : undefined;
};

export const params = {
  baseURL: 'https://api.gmi-serving.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_GMICLOUD_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: GMICloudModelCard[] = modelsPage.data || [];

    const standardList = modelList.map((model) => ({
      contextWindowTokens: model.context_length,
      id: model.id,
      pricing: {
        cachedInput: toPerMillion(model.pricing?.input_cache_read),
        input: toPerMillion(model.pricing?.prompt),
        output: toPerMillion(model.pricing?.completion),
        writeCacheInput: toPerMillion(model.pricing?.input_cache_write),
      },
    }));

    return processMultiProviderModelList(standardList, 'gmicloud');
  },
  provider: ModelProvider.GMICloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeGMICloudAI = createOpenAICompatibleRuntime(params);
