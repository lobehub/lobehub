import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'https://global.api-route.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_API_ROUTE_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.ApiRoute,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeApiRouteAI = createOpenAICompatibleRuntime(params);
