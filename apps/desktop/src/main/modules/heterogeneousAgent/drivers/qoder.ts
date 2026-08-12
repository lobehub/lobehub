import { buildQoderArgs } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

export const qoderDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    mcpConfigPath,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const inputPlan = await helpers.buildAgentInput('qoder', promptInput);

    return {
      args: buildQoderArgs({
        extraArgs: [...(mcpConfigPath ? ['--mcp-config', mcpConfigPath] : []), ...args],
        inputArgs: inputPlan.args,
        resumeSessionId,
      }),
      stdinPayload: inputPlan.stdin,
    };
  },
};
