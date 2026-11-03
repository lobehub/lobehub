// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeSambaNovaAI } from './index';

const provider = ModelProvider.SambaNova;
const defaultBaseURL = 'https://api.sambanova.ai/v1';

testProvider({
  Runtime: LobeSambaNovaAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_SAMBANOVA_CHAT_COMPLETION',
  chatModel: 'Meta-Llama-3.1-8B-Instruct',
  test: {
    skipAPICall: true,
  },
});
