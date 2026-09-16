import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

const localAPIKey = 'funasr-local';

export const params = {
  apiKey: localAPIKey,
  baseURL: 'http://localhost:8000/v1',
  // Never forward an unrelated provider key to a user-controlled local endpoint.
  constructorOptions: { apiKey: localAPIKey },
  provider: ModelProvider.FunASR,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeFunASRAI = createOpenAICompatibleRuntime(params);
