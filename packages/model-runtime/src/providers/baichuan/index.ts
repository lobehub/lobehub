import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import type { ChatStreamPayload } from '../../types';

export interface BaichuanModelCard {
  function_call: boolean;
  max_input_length: number;
  max_tokens: number;
  model: string;
  model_show_name: string;
}

export const params = {
  baseURL: 'https://api.baichuan-ai.com/v1',
  chatCompletion: {
    handlePayload: (payload: ChatStreamPayload) => {
      const { enabledSearch, temperature, tools, ...rest } = payload;

      const baichuanTools = enabledSearch
        ? [
            ...(tools || []),
            {
              type: 'web_search',
              web_search: {
                enable: true,
                search_mode: process.env.BAICHUAN_SEARCH_MODE || 'performance_first', // performance_first or quality_first
              },
            },
          ]
        : tools;

      // Resolve parameters with normalization
      const resolvedParams = resolveParameters({ temperature }, { normalizeTemperature: true });

      return {
        ...rest,
        temperature: resolvedParams.temperature,
        tools: baichuanTools,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_BAICHUAN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: BaichuanModelCard[] = modelsPage.data;

    return modelList.filter(Boolean).map((model) => {
      const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
        (m) => model.model.toLowerCase() === m.id.toLowerCase(),
      );

      return {
        contextWindowTokens: model.max_input_length,
        displayName: model.model_show_name,
        enabled: knownModel?.enabled || false,
        functionCall: model.function_call,
        id: model.model,
        maxOutput: model.max_tokens,
        reasoning: knownModel?.abilities?.reasoning || false,
        vision: knownModel?.abilities?.vision || false,
      };
    }) as ChatModelCard[];
  },
  provider: ModelProvider.Baichuan,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeBaichuanAI = createOpenAICompatibleRuntime(params);
