import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';

export interface ZenMuxModelCard {
  created: number;
  id: string;
  object: string;
  owned_by: string;
}

const DEFAULT_BASE_URL = 'https://zenmux.ai';

export const params = {
  chatCompletion: {
    handlePayload: (payload) => {
      const { reasoning_effort, thinking, reasoning, ...rest } = payload;

      const finalReasoning = {
        ...reasoning,
        ...(reasoning_effort && { effort: reasoning_effort }),
        ...(thinking?.budget_tokens && { max_tokens: thinking.budget_tokens }),
        ...(thinking?.type === 'enabled' && { enabled: true }),
        ...(thinking?.type === 'disabled' && { enabled: false }),
      };

      const hasReasoning = Object.keys(finalReasoning).length > 0;

      return {
        ...rest,
        ...(hasReasoning && { reasoning: finalReasoning }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ZENMUX_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.ZenMux,
  models: async ({ client: openAIClient }) => {
    const modelsPage = (await openAIClient.models.list()) as any;
    const modelList: ZenMuxModelCard[] = modelsPage.data || [];

    return processMultiProviderModelList(modelList, 'zenmux');
  },
  routers: (options) => {
    const baseURL = options.baseURL || DEFAULT_BASE_URL;
    const userBaseURL = baseURL.replace(/\/v\d+[a-z]*\/?$/, '').replace(/\/api\/?$/, '');

    return [
      {
        apiType: 'anthropic',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
          (id) => detectModelProvider(id) === 'anthropic',
        ),
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/api/anthropic'),
        },
      },
      {
        apiType: 'google',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
          (id) => detectModelProvider(id) === 'google',
        ),
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/api/vertex-ai'),
        },
      },
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/api/v1'),
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeZenMuxAI = createRouterRuntime(params);
