import { CURSOR_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

export const cursorDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const input = await helpers.buildAgentInput('cursor', promptInput);
    return {
      args: [
        ...CURSOR_BASE_ARGS,
        ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
        ...args,
        ...input.args,
        '--',
      ],
      argvPayload: input.stdin,
    };
  },
};
