// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeMinimaxCodingPlanAI } from './index';

const provider = ModelProvider.MinimaxCodingPlan;
const defaultBaseURL = 'https://api.minimaxi.com/v1';

testProvider({
  Runtime: LobeMinimaxCodingPlanAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_MINIMAX_CODING_PLAN_CHAT_COMPLETION',
  chatModel: 'MiniMax-M2.7',
  test: {
    skipAPICall: true,
  },
});
