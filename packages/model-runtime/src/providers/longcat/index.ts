import { longcat as longchatCahtModels, ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { getModelMaxOutputs } from '../../utils/getModelMaxOutputs';

export const LobeLongCatAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.longcat.chat/openai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { frequency_penalty, max_tokens, presence_penalty, ...rest } = payload;

      return {
        ...rest,
        frequency_penalty: undefined,
        max_tokens:
          max_tokens !== undefined
            ? max_tokens
            : getModelMaxOutputs(payload.model, longchatCahtModels),
        presence_penalty: undefined,
        stream: true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_LONGCAT_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.LongCat,
});
