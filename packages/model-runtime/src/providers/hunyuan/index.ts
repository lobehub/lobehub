import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'https://tokenhub.tencentmaas.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { frequency_penalty, model, presence_penalty, ...rest } = payload;

      return {
        ...rest,
        frequency_penalty: undefined,
        model,
        presence_penalty: undefined,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_HUNYUAN_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Hunyuan,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeHunyuanAI = createOpenAICompatibleRuntime(params);
