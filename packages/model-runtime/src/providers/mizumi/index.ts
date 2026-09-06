import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeMizumi = createOpenAICompatibleRuntime({
  baseURL: 'https://api.mizumi.co/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_MIZUMI_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Mizumi,
});
