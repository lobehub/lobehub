import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface InternLMModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://chat.intern-ai.org.cn/api/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { thinking, ...rest } = payload as any;

      return {
        ...rest,
        ...(thinking.type !== undefined && {
          thinking_mode: thinking.type === 'enabled',
        }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_INTERNLM_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const functionCallKeywords = ['internlm', 'intern-s'];

    const visionKeywords = ['internvl', 'intern-s'];

    const modelsPage = (await client.models.list()) as any;
    const modelList: InternLMModelCard[] = modelsPage.data;

    return modelList
      .filter((model) => model && model.id)
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: knownModel?.contextWindowTokens ?? undefined,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall:
            functionCallKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.functionCall ||
            false,
          id: model.id,
          reasoning: knownModel?.abilities?.reasoning || false,
          vision:
            visionKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.vision ||
            false,
        };
      }) as ChatModelCard[];
  },
  provider: ModelProvider.InternLM,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeInternLMAI = createOpenAICompatibleRuntime(params);
