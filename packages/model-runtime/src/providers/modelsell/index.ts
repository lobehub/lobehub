import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'https://modelsell.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_MODELSELL_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Modelsell,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeModelsellAI = createOpenAICompatibleRuntime(params);
