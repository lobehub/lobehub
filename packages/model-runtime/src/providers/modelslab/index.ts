import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'https://modelslab.com/api/uncensored-chat/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_MODELSLAB_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.ModelsLab,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeModelsLabAI = createOpenAICompatibleRuntime(params);
