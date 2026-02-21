import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://ollama.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, ...rest } = payload;

      return {
        ...rest,
        model,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const modelList = Array.isArray(modelsPage?.data)
        ? modelsPage.data
        : Array.isArray(modelsPage)
          ? modelsPage
          : [];

      return await processMultiProviderModelList(modelList, 'ollamacloud');
    } catch (error) {
      console.warn(
        'Failed to fetch Ollama Cloud models. Please ensure your Ollama Cloud API key is valid:',
        error,
      );
      return [];
    }
  },
  provider: ModelProvider.OllamaCloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOllamaCloudAI = createOpenAICompatibleRuntime(params);
