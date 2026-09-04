import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeMetaAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.meta.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_META_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Meta,
});
