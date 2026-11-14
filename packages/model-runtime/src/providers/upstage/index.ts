import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';

export const LobeUpstageAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.upstage.ai/v1/solar',
  debug: {
    chatCompletion: () => process.env.DEBUG_UPSTAGE_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Upstage,
});
