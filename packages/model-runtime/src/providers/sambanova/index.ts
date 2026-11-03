import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeSambaNovaAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.sambanova.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_SAMBANOVA_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.SambaNova,
});
