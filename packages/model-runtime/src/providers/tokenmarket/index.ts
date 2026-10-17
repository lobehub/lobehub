import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://api.tokensmarket.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_TOKENMARKET_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelList = (await client.models.list()).data;

    return processMultiProviderModelList(modelList, 'tokenmarket');
  },
  provider: ModelProvider.TokenMarket,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeTokenMarketAI = createOpenAICompatibleRuntime(params);
