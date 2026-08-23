import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { PPIOModelCard } from './type';

export const LobePPIOAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.ppinfra.com/v3/openai',
  constructorOptions: {
    defaultHeaders: {
      'X-API-Source': 'lobechat',
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_PPIO_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const reasoningKeywords = ['deepseek-r1'];

    const modelsPage = (await client.models.list()) as any;
    const modelList: PPIOModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        // PPIO declares capabilities on the model card itself (`features`,
        // `input_modalities`); prefer them over known-model / keyword fallbacks so
        // models outside the curated list keep their native abilities
        return {
          contextWindowTokens: model.context_size,
          description: model.description,
          displayName:
            model.display_name?.replaceAll(/[\t（）]/g, (match) =>
              match === '（' ? ' (' : match === '）' ? ')' : '',
            ) ||
            model.title ||
            model.id,
          enabled: knownModel?.enabled || false,
          functionCall:
            model.features?.includes('function-calling') ||
            knownModel?.abilities?.functionCall ||
            false,
          id: model.id,
          ...(model.max_output_tokens ? { maxOutput: model.max_output_tokens } : {}),
          reasoning:
            model.features?.includes('reasoning') ||
            reasoningKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.reasoning ||
            false,
          video: model.input_modalities?.includes('video') || knownModel?.abilities?.video || false,
          vision:
            model.input_modalities?.includes('image') ||
            model.description.toLowerCase().includes('视觉') ||
            knownModel?.abilities?.vision ||
            false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.PPIO,
});
