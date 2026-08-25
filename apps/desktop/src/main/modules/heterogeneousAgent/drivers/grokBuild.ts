import { buildGrokAcpArgs } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentDriver } from '../types';

/**
 * Grok Build uses the bidirectional ACP stdio transport in the controller.
 * This driver remains registered for descriptor consistency; its plan is only
 * a diagnostic representation and is never passed to the generic one-shot
 * spawn path.
 */
export const grokBuildDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return {
      args: buildGrokAcpArgs(args),
    };
  },
};
