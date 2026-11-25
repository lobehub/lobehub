import { buildDoubaoArgs } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

export const doubaoDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const { stdin: stdinPayload } = await helpers.buildAgentInput('doubao', promptInput);

    return {
      // No `--mcp-config`: Doubao has no MCP flag, unlike the Claude-compatible
      // CLIs whose drivers forward it.
      args: buildDoubaoArgs({ extraArgs: args, resumeSessionId }),
      stdinPayload,
    };
  },
};
