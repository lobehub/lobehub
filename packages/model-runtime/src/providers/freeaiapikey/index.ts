import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeFreeaiapikeyAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.freeaiapikey.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_FREEAIKEYAPIKEY_CHAT_COMPLETION === '1',
  },
});
