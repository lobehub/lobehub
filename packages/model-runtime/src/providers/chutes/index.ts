import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'https://llm.chutes.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_CHUTES_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Chutes,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeChutesAI = createOpenAICompatibleRuntime(params);
