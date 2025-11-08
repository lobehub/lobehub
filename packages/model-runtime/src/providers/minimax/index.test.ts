// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeMinimaxAI } from './index';

const provider = ModelProvider.Minimax;
const defaultBaseURL = 'https://api.minimaxi.com/v1';

testProvider({
  Runtime: LobeMinimaxAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_MINIMAX_CHAT_COMPLETION',
  chatModel: 'abab6.5s-chat',
  test: {
    skipAPICall: true,
  },
});
