import { KIMI_CODE_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

export const kimiCodeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const inputPlan = await helpers.buildAgentInput('kimi-code', promptInput);
    return {
      args: [
        ...KIMI_CODE_BASE_ARGS,
        ...(resumeSessionId ? ['--session', resumeSessionId] : []),
        ...args,
        ...inputPlan.args,
      ],
      stdinPayload: inputPlan.stdin,
    };
  },
};
