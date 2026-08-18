import { PI_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

export const piDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const inputPlan = await helpers.buildAgentInput('pi', promptInput);

    return {
      args: [
        ...PI_BASE_ARGS,
        ...(resumeSessionId ? ['--session-id', resumeSessionId] : []),
        ...args,
        ...inputPlan.args,
      ],
      stdinPayload: inputPlan.stdin,
    };
  },
};
