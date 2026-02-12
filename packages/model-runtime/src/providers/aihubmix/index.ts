import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { responsesAPIModels } from '../../const/models';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';

export interface AiHubMixModelCard {
  created: number;
  id: string;
  object: string;
  owned_by: string;
}

const baseURL = 'https://aihubmix.com';

export const params: CreateRouterRuntimeOptions = {
  debug: {
    chatCompletion: () => process.env.DEBUG_AIHUBMIX_CHAT_COMPLETION === '1',
  },
  defaultHeaders: {
    'APP-Code': 'LobeHub',
  },
  id: ModelProvider.AiHubMix,
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const modelList: AiHubMixModelCard[] = modelsPage.data || [];

      return await processMultiProviderModelList(modelList, 'aihubmix');
    } catch (error) {
      console.warn(
        'Failed to fetch AiHubMix models. Please ensure your AiHubMix API key is valid:',
        error,
      );
      return [];
    }
  },
  routers: [
    {
      apiType: 'anthropic',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'anthropic',
      ),
      options: { baseURL },
    },
    {
      apiType: 'google',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'google',
      ),
      options: { baseURL: urlJoin(baseURL, '/gemini') },
    },
    {
      apiType: 'xai',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'xai',
      ),
      options: { baseURL: urlJoin(baseURL, '/v1') },
    },
    {
      apiType: 'deepseek',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      options: { baseURL: urlJoin(baseURL, '/v1') },
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

export const LobeAiHubMixAI = createRouterRuntime(params);
