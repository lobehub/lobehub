import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const TOWERAI_DEFAULT_BASE_URL = 'https://tower-ai.yottastudios.com';

/**
 * Resolves the correct Tower AI API endpoint based on the model.
 * GPT models → /zi/webapi/chat/openai
 * Claude/Gemini → /zi/webapi/chat/vertexai
 * DeepSeek → /zi/webapi/chat/newapi
 */
export function resolveTowerAIEndpoint(baseUrl: string, model: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (model.startsWith('gemini') || model.startsWith('claude')) {
    return `${base}/zi/webapi/chat/vertexai`;
  }
  if (model.startsWith('deepseek')) {
    return `${base}/zi/webapi/chat/newapi`;
  }
  return `${base}/zi/webapi/chat/openai`;
}

export const params = {
  baseURL: `${TOWERAI_DEFAULT_BASE_URL}/zi/webapi/chat/openai`,
  chatCompletion: {
    handlePayload: (payload) => {
      return { ...payload, stream: payload.stream ?? true } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_TOWERAI_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: 'TowerAIBizError',
    invalidAPIKey: 'InvalidTowerAIAPIKey',
  },
  provider: ModelProvider.TowerAI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeTowerAI = createOpenAICompatibleRuntime(params);
