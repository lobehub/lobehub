import { OPENCODE_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

export const opencodeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const inputPlan = await helpers.buildAgentInput('opencode', promptInput);

    return {
      args: [
        ...OPENCODE_BASE_ARGS,
        ...(resumeSessionId ? ['--session', resumeSessionId] : []),
        ...args,
        ...inputPlan.args,
      ],
      stdinPayload: inputPlan.stdin,
    };
  },
};
