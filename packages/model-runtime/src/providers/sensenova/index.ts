import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import { convertSenseNovaMessage } from '../../core/contextBuilders/sensenova';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface SenseNovaModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        frequency_penalty,
        max_tokens,
        messages,
        model,
        temperature,
        thinking,
        top_p,
        ...rest
      } = payload;

      return {
        ...rest,
        frequency_penalty:
          frequency_penalty !== undefined && frequency_penalty > 0 && frequency_penalty <= 2
            ? frequency_penalty
            : undefined,
        max_new_tokens: max_tokens !== undefined && max_tokens > 0 ? max_tokens : undefined,
        messages: messages.map((message) =>
          message.role !== 'user' || !model || !/^Sense(Nova-V6|Chat-Vision)/.test(model)
            ? message
            : { ...message, content: convertSenseNovaMessage(message.content) },
        ) as any[],
        model,
        stream: true,
        temperature:
          temperature !== undefined && temperature > 0 && temperature <= 2
            ? temperature
            : undefined,
        thinking: thinking
          ? model && model.includes('-V6-5-') && thinking.type === 'enabled'
            ? { enabled: true }
            : { enabled: false }
          : undefined,
        top_p: top_p !== undefined && top_p > 0 && top_p < 1 ? top_p : undefined,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_SENSENOVA_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const functionCallKeywords = ['1202'];

    const visionKeywords = ['vision', 'sensenova-v6'];

    const reasoningKeywords = ['deepseek-r1', 'reasoner'];

    client.baseURL = 'https://api.sensenova.cn/v1/llm';

    const modelsPage = (await client.models.list()) as any;
    const modelList: SenseNovaModelCard[] = modelsPage.data;

    return modelList
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
          reasoning:
            reasoningKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.reasoning ||
            false,
          vision:
            visionKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.vision ||
            false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.SenseNova,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSenseNovaAI = createOpenAICompatibleRuntime(params);
