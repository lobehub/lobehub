import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface SaggModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.privatedeskai.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_SAGG_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: SaggModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'sagg');
  },
  provider: ModelProvider.Sagg,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSaggAI = createOpenAICompatibleRuntime(params);
