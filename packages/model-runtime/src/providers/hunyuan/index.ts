import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createHunyuanImage } from './createImage';
import { createHunyuanVideo } from './createVideo';

export const params = {
  baseURL: 'https://tokenhub.tencentmaas.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, model, thinking, ...rest } = payload;

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
        stream: rest.stream ?? true,
        thinking: thinking ? { type: thinking.type } : undefined,
        messages,
        model,
        presence_penalty: undefined,
        ...(enabledSearch && {
          citation: true,
          enable_enhancement: true,
          /*
          enable_multimedia: true,
          */
          enable_speed_search: process.env.HUNYUAN_ENABLE_SPEED_SEARCH === '1',
          search_info: true,
        }),
      } as any;
    },
  },
  createImage: createHunyuanImage,
  createVideo: createHunyuanVideo,
  handlePollVideoStatus: async (inferenceId, options) => {
    const { pollHunyuanVideoStatus } = await import('./createVideo');
    return pollHunyuanVideoStatus(inferenceId, options.apiKey || '', options.baseURL || '');
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_HUNYUAN_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Hunyuan,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeHunyuanAI = createOpenAICompatibleRuntime(params);
