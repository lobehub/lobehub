import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeOpenCodeZenAI = createOpenAICompatibleRuntime({
  baseURL: 'https://opencode.ai/zen/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODEZEN_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_OPENCODEZEN_RESPONSES === '1',
  },
  provider: ModelProvider.OpenCodeZen,
});
