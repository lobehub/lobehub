import { buildTraeAcpArgs } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentDriver } from '../types';

/**
 * TRAE uses a bidirectional ACP session rather than the ordinary one-way JSONL
 * process path. This driver keeps type registration consistent; the desktop
 * controller hands the resulting arguments to `TraeAcpSession` directly.
 */
export const traeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return { args: buildTraeAcpArgs(args) };
  },
};
