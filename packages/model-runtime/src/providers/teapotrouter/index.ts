import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface TeapotRouterModelCard {
  id: string;
  object: string;
  owned_by: string;
}

export const params = {
  baseURL: 'https://api.teapotrouter.com/v1',
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
    chatCompletion: () => process.env.DEBUG_TEAPOTROUTER_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: any[] = modelsPage.data || [];

    const modelList: TeapotRouterModelCard[] = rawList.map((model) => ({
      id: model.id,
      object: model.object,
      owned_by: model.owned_by,
    }));

    return await processMultiProviderModelList(modelList, 'teapot-router');
  },
  provider: ModelProvider.TeapotRouter,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeTeapotRouterAI = createOpenAICompatibleRuntime(params);
