import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

/**
 * Eden AI (https://www.edenai.co) is an OpenAI-compatible aggregator that
 * exposes 100+ models from many providers through a single EU-hosted endpoint
 * and API key. Models use the `provider/model` naming scheme.
 */
export const LobeEdenAIAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.edenai.run/v3',
  debug: {
    chatCompletion: () => process.env.DEBUG_EDENAI_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.EdenAI,
});
