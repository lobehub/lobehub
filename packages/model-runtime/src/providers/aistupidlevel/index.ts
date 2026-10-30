import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeAIStupidLevelAI = createOpenAICompatibleRuntime({
  baseURL: 'https://aistupidlevel.info/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_AISTUPIDLEVEL_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.AIStupidLevel,
});
