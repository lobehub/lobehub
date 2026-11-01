import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface V0ModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.v0.dev/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_V0_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: V0ModelCard[] = Array.isArray(modelsPage?.data)
      ? modelsPage.data
      : Array.isArray(modelsPage)
        ? modelsPage
        : [];

    return processModelList(modelList, MODEL_LIST_CONFIGS.v0, 'v0');
  },
  provider: ModelProvider.V0,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeV0AI = createOpenAICompatibleRuntime(params);
