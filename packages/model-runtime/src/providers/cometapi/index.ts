import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface CometAPIModelCard {
  id: string;
  object: string;
  owned_by: string;
}

export const params = {
  baseURL: 'https://api.cometapi.com/v1',
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
    chatCompletion: () => process.env.DEBUG_COMETAPI_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const rawList: any[] = modelsPage.data || [];

      // 处理模型列表，移除不必要的字段
      const modelList: CometAPIModelCard[] = rawList.map((model) => ({
        id: model.id,
        object: model.object,
        owned_by: model.owned_by,
      }));

      return await processMultiProviderModelList(modelList, 'cometapi');
    } catch (error) {
      console.warn(
        'Failed to fetch CometAPI models. Please ensure your CometAPI API key is valid:',
        error,
      );
      return [];
    }
  },
  provider: ModelProvider.CometAPI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeCometAPIAI = createOpenAICompatibleRuntime(params);
