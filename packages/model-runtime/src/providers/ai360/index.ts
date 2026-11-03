import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface Ai360ModelCard {
  id: string;
  max_tokens: number;
  total_tokens: number;
}

export const params = {
  baseURL: 'https://api.360.cn/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, tools, ...rest } = payload;

      const ai360Tools = enabledSearch
        ? [
            ...(tools || []),
            {
              type: 'web_search',
              web_search: {
                search_mode: 'auto',
              },
            },
          ]
        : tools;

      return {
        ...rest,
        stream: !ai360Tools,
        tools: ai360Tools,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_AI360_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const reasoningKeywords = ['360gpt2-o1', '360zhinao2-o1'];

    const modelsPage = (await client.models.list()) as any;
    const modelList: Ai360ModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: model.total_tokens,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall: model.id === '360gpt-pro' || knownModel?.abilities?.functionCall || false,
          id: model.id,
          maxOutput: typeof model.max_tokens === 'number' ? model.max_tokens : undefined,
          reasoning:
            reasoningKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.reasoning ||
            false,
          vision: knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.Ai360,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAi360AI = createOpenAICompatibleRuntime(params);
