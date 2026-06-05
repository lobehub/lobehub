import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeAtlasCloudAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.atlascloud.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_ATLASCLOUD_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.AtlasCloud,
});
