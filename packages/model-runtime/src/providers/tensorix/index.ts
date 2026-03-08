import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeTensorixAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.tensorix.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_TENSORIX_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Tensorix,
});
