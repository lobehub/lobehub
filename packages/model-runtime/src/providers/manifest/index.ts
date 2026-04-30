import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'https://app.manifest.build/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_MANIFEST_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Manifest,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeManifestAI = createOpenAICompatibleRuntime(params);
