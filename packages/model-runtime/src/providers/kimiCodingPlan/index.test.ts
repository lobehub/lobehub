// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeKimiCodingPlanAI } from './index';

const provider = ModelProvider.KimiCodingPlan;
const defaultBaseURL = 'https://api.kimi.com/coding/v1';

testProvider({
  Runtime: LobeKimiCodingPlanAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_KIMI_CODING_PLAN_CHAT_COMPLETION',
  chatModel: 'kimi-k2.5',
  test: {
    skipAPICall: true,
  },
});
