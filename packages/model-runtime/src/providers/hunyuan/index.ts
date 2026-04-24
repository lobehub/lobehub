import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createHunyuanImage } from './createImage';

export const params = {
  baseURL: 'https://tokenhub.tencentmaas.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { frequency_penalty, model, presence_penalty, ...rest } = payload;

      // Transform reasoning object to reasoning_content string for multi-turn conversations
      const messages = payload.messages.map((message: any) => {
        const { reasoning, ...rest } = message;

        const reasoningContent =
          typeof rest.reasoning_content === 'string'
            ? rest.reasoning_content
            : typeof reasoning?.content === 'string'
              ? reasoning.content
              : undefined;

        if (message.role === 'assistant' && model === 'hy3-preview') {
          return {
            ...rest,
            reasoning_content: reasoningContent ?? '',
          };
        }

        if (reasoningContent !== undefined) {
          return {
            ...rest,
            reasoning_content: reasoningContent,
          };
        }

        return rest;
      });

      return {
        ...rest,
        frequency_penalty: undefined,
        messages,
        model,
        presence_penalty: undefined,
      } as any;
    },
  },
  createImage: createHunyuanImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_HUNYUAN_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Hunyuan,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeHunyuanAI = createOpenAICompatibleRuntime(params);
