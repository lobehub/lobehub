import { buildAntigravityArgs } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentDriver } from '../types';

export const antigravityDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args, helpers, promptInput, resumeSessionId }) {
    const input = await helpers.buildAgentInput('antigravity', promptInput);
    return {
      args: buildAntigravityArgs({ extraArgs: args, resumeSessionId }),
      stdinPayload: input.stdin,
    };
  },
};
