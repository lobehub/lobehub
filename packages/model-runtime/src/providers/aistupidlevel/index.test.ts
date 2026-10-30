// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeAIStupidLevelAI } from './index';

const provider = ModelProvider.AIStupidLevel;
const defaultBaseURL = 'https://aistupidlevel.info/v1';

testProvider({
  Runtime: LobeAIStupidLevelAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_AISTUPIDLEVEL_CHAT_COMPLETION',
  chatModel: 'auto-best',
  test: {
    skipAPICall: true,
  },
});
