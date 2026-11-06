import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

/**
 * deAPI's OpenAI-compatible gateway serves images (`/images/generations`, `/images/edits`)
 * and asynchronous video (`/videos`, polled at `/videos/{id}`, downloaded from the key-gated
 * `/videos/{id}/content`), which the factory defaults already speak. It has no chat endpoint.
 *
 * @see https://docs.deapi.ai/openai-compatibility
 */
export const params = {
  baseURL: 'https://oai.deapi.ai/v1',
  provider: ModelProvider.DeAPI,
} as const;

export const LobeDeAPIAI = createOpenAICompatibleRuntime(params);
