import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobePinstripesAI = createOpenAICompatibleRuntime({
  baseURL: 'https://pinstripes.io/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_PINSTRIPES_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Pinstripes,
});
