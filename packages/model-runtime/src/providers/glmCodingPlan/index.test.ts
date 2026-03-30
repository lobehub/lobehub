// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeGLMCodingPlanAI } from './index';

const provider = ModelProvider.GLMCodingPlan;
const defaultBaseURL = 'https://api.z.ai/api/paas/v4';

testProvider({
  Runtime: LobeGLMCodingPlanAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_GLM_CODING_PLAN_CHAT_COMPLETION',
  chatModel: 'GLM-4.7',
  test: {
    skipAPICall: true,
  },
});
