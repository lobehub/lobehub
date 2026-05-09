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

const baseURL = 'https://api.aihubmix.com';

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
      const apiKey = (client as any).apiKey as string | undefined;
      if (!apiKey) throw new Error('AiHubMix API key is missing');

      // AiHubMix exposes two model list endpoints:
      // - https://api.aihubmix.com/v1/models  — returns per-user-group list only (~256 models)
      // - https://aihubmix.com/api/v1/models  — returns the complete model catalog (800+)
      // Use the full endpoint so users can access all available models.
      // Note: this endpoint uses `model_id` instead of `id`; normalize before processing.
      // 'APP-Code' is an AiHubMix-required client identifier (see https://docs.aihubmix.com/cn/api/Models-API).
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch('https://aihubmix.com/api/v1/models', {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'APP-Code': 'LobeHub',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const json = (await response.json()) as any;
      const modelList: AiHubMixModelCard[] = (json.data || []).map((m: any) => ({
        ...m,
        id: m.id ?? m.model_id,
      }));
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
