import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface UnslothModelCard {
  id: string;
}

export const params = {
  apiKey: 'placeholder-to-avoid-error',
  baseURL: 'http://127.0.0.1:8000/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_UNSLOTH_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: UnslothModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: knownModel?.contextWindowTokens ?? undefined,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall: knownModel?.abilities?.functionCall || false,
          id: model.id,
          reasoning: knownModel?.abilities?.reasoning || false,
          vision: knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.Unsloth,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeUnslothAI = createOpenAICompatibleRuntime(params);
