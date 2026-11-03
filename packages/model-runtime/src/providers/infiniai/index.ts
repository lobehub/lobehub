import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface InfiniAIModelCard {
  id: string;
}

export const LobeInfiniAI = createOpenAICompatibleRuntime({
  baseURL: 'https://cloud.infini-ai.com/maas/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, ...rest } = payload;

      return {
        ...rest,
        enable_thinking: thinking !== undefined ? thinking.type === 'enabled' : false,
        model,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_INFINIAI_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: InfiniAIModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'infiniai');
  },
  provider: ModelProvider.InfiniAI,
});
