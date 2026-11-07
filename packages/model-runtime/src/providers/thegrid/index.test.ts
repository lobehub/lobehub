// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeTheGridAI } from './index';

const provider = ModelProvider.TheGrid;
const defaultBaseURL = 'https://api.thegrid.ai/v1';

testProvider({
  Runtime: LobeTheGridAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_THEGRID_CHAT_COMPLETION',
  chatModel: 'text-standard',
  test: {
    skipAPICall: true,
  },
});
