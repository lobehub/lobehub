import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeLongCatAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.longcat.chat/openai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { frequency_penalty, presence_penalty, thinking, ...rest } = payload;

      return {
        ...rest,
        frequency_penalty: undefined,
        presence_penalty: undefined,
        ...(thinking && {
          enable_thinking: thinking.type ? thinking.type !== 'disabled' : undefined,
          ...(thinking?.budget_tokens !== 0 && {
            thinking_budget: Math.max(thinking?.budget_tokens, 1024),
          }),
        }),
        stream: true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_LONGCAT_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.LongCat,
});
