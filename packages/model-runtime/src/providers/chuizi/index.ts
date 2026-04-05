import { ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { responsesAPIModels } from '../../const/models';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';

export interface ChuiziModelCard {
  created: number;
  id: string;
  object: string;
  owned_by: string;
}

const baseURL = 'https://api.chuizi.ai';

export const params: CreateRouterRuntimeOptions = {
  debug: {
    chatCompletion: () => process.env.DEBUG_CHUIZI_CHAT_COMPLETION === '1',
  },
  defaultHeaders: {
    'X-Client': 'LobeHub',
  },
  id: ModelProvider.Chuizi,
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const modelList: ChuiziModelCard[] = modelsPage.data || [];

      return await processMultiProviderModelList(modelList, 'chuizi');
    } catch (error) {
      console.warn(
        'Failed to fetch Chuizi.AI models. Please ensure your Chuizi.AI API key is valid:',
        error,
      );
      return [];
    }
  },
  routers: [
    {
      apiType: 'anthropic',
      models: async ({ client }) => {
        try {
          const modelsPage = (await client.models.list()) as any;
          const modelList: ChuiziModelCard[] = modelsPage.data || [];
          return modelList
            .map((m) => m.id)
            .filter((id) => detectModelProvider(id) === 'anthropic');
        } catch {
          return [];
        }
      },
      options: { baseURL: urlJoin(baseURL, '/anthropic') },
    },
    {
      apiType: 'openai',
      options: {
        baseURL: urlJoin(baseURL, '/v1'),
        chatCompletion: {
          useResponseModels: [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
        },
      },
    },
  ],
};

export const LobeChuiziAI = createRouterRuntime(params);
