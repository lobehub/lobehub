import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://api.cerebras.ai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        frequency_penalty: _frequencyPenalty,
        presence_penalty: _presencePenalty,
        model,
        ...rest
      } = payload;

      return {
        ...rest,
        model,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_CEREBRAS_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList = Array.isArray(modelsPage?.data)
      ? modelsPage.data
      : Array.isArray(modelsPage)
        ? modelsPage
        : [];

    return await processMultiProviderModelList(modelList, 'cerebras');
  },
  provider: ModelProvider.Cerebras,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeCerebrasAI = createOpenAICompatibleRuntime(params);
