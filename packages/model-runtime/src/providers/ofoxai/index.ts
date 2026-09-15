import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeOfoxAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.ofox.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_OFOXAI_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.OfoxAI,
});
