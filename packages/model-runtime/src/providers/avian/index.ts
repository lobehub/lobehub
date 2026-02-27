import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeAvianAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.avian.io/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_AVIAN_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Avian,
});
