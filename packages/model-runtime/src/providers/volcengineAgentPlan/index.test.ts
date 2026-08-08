// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeVolcengineAgentPlanAI } from './index';

const provider = ModelProvider.VolcengineAgentPlan;
const defaultBaseURL = 'https://ark.cn-beijing.volces.com/api/plan/v3';

testProvider({
  Runtime: LobeVolcengineAgentPlanAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_VOLCENGINE_AGENT_PLAN_CHAT_COMPLETION',
  chatModel: 'doubao-seed-2.0-mini',
  test: {
    skipAPICall: true,
  },
});
