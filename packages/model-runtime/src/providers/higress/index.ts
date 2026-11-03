import type { ChatModelCard } from '@lobechat/types';
import { uniqueId } from 'es-toolkit/compat';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface HigressModelCard {
  context_length: number;
  description: string;
  id: string;
  name: string;
  top_provider: {
    max_completion_tokens: number;
  };
}

export const params = {
  constructorOptions: {
    defaultHeaders: {
      'HTTP-Referer': 'https://lobehub.com',
      'X-Title': 'LobeHub',
      'x-Request-Id': uniqueId('lobe-chat-'),
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_HIGRESS_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: HigressModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: model.context_length,
          description: model.description,
          displayName: model.name,
          enabled: knownModel?.enabled || false,
          functionCall:
            model.description.includes('function calling') ||
            model.description.includes('tools') ||
            knownModel?.abilities?.functionCall ||
            false,
          id: model.id,
          maxTokens: model.top_provider.max_completion_tokens,
          reasoning:
            model.description.includes('reasoning') || knownModel?.abilities?.reasoning || false,
          vision:
            model.description.includes('vision') ||
            model.description.includes('multimodal') ||
            model.id.includes('vision') ||
            knownModel?.abilities?.vision ||
            false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.Higress,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeHigressAI = createOpenAICompatibleRuntime(params);
