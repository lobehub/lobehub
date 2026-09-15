import { buildDroidAcpArgs } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentDriver } from '../types';

/** Factory Droid prompts run through its native bidirectional ACP session. */
export const droidDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return { args: buildDroidAcpArgs(args) };
  },
};
