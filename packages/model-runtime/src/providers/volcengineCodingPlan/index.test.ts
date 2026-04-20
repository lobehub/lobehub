// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeVolcengineCodingPlanAI } from './index';

const provider = ModelProvider.VolcengineCodingPlan;
const defaultBaseURL = 'https://ark.cn-beijing.volces.com/api/coding/v3';

testProvider({
  Runtime: LobeVolcengineCodingPlanAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_VOLCENGINE_CODING_PLAN_CHAT_COMPLETION',
  chatModel: 'doubao-seed-code',
  test: {
    skipAPICall: true,
  },
});
