import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeTheGridAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.thegrid.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_THEGRID_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.TheGrid,
});
