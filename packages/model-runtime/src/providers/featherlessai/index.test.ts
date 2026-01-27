// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { testProvider } from '../../providerTestUtils';

import { LobeFeatherlessAI } from './index';

const provider = ModelProvider.FeatherlessAI;
const defaultBaseURL = 'https://api.featherless.ai/v1';

testProvider({
  Runtime: LobeFeatherlessAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_FEATHERLESSAI_CHAT_COMPLETION',
  chatModel: 'moonshotai/Kimi-K2-Instruct-0905',
});