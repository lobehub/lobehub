import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface OfoxAIModelCard {
  id: string;
  object: string;
  owned_by: string;
}

export const params = {
  baseURL: 'https://api.ofox.ai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, ...rest } = payload;

      return {
        ...rest,
        model,
        stream: true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OFOXAI_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const rawList: any[] = modelsPage.data || [];

      const modelList: OfoxAIModelCard[] = rawList.map((model) => ({
        id: model.id,
        object: model.object,
        owned_by: model.owned_by,
      }));

      return await processMultiProviderModelList(modelList, 'ofoxai');
    } catch (error) {
      console.warn(
        'Failed to fetch OfoxAI models. Please ensure your OfoxAI API key is valid:',
        error,
      );
      return [];
    }
  },
  provider: ModelProvider.OfoxAI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOfoxAI = createOpenAICompatibleRuntime(params);
