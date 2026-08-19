import { buildMinimaxCodeAcpArgs } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentDriver } from '../types';

/**
 * MiniMax Code uses a bidirectional ACP session rather than the ordinary
 * one-way JSONL process path. This driver keeps type registration consistent;
 * the desktop controller hands the resulting arguments to `MinimaxCodeAcpSession`.
 */
export const minimaxCodeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return { args: buildMinimaxCodeAcpArgs(args) };
  },
};
