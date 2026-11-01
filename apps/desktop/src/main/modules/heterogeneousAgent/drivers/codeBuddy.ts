import { CODEBUDDY_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const DESKTOP_CODEBUDDY_ARGS = [
  ...CODEBUDDY_BASE_ARGS,
  '--include-partial-messages',
  '--permission-mode',
  'bypassPermissions',
] as const;

export const codeBuddyDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    mcpConfigPath,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const { stdin: stdinPayload } = await helpers.buildAgentInput('codebuddy', promptInput);

    return {
      args: [
        ...DESKTOP_CODEBUDDY_ARGS,
        ...(mcpConfigPath ? ['--mcp-config', mcpConfigPath] : []),
        ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
        ...args,
      ],
      stdinPayload,
    };
  },
};
