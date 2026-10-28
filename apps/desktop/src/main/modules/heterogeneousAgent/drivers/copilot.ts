import { buildCopilotAcpArgs } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentDriver } from '../types';

/** GitHub Copilot prompts run through its native bidirectional ACP session. */
export const copilotDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return { args: buildCopilotAcpArgs(args) };
  },
};
