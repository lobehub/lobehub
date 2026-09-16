// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeFuturMixAI } from './index';

const provider = ModelProvider.FuturMix;
const defaultBaseURL = 'https://futurmix.ai/v1';

testProvider({
  Runtime: LobeFuturMixAI,
  chatDebugEnv: 'DEBUG_FUTURMIX_CHAT_COMPLETION',
  chatModel: 'gpt-4o',
  defaultBaseURL,
  provider,
});
