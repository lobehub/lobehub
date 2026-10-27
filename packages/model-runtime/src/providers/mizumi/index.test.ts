// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeMizumi } from './index';

const provider = ModelProvider.Mizumi;
const defaultBaseURL = 'https://api.mizumi.co/v1';

testProvider({
  Runtime: LobeMizumi,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_MIZUMI_CHAT_COMPLETION',
  chatModel: 'gpt-4.1-mini',
  test: {
    skipAPICall: true,
  },
});
