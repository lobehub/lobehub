import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import type { LobeAgentConfig } from '@lobechat/types';
import { cleanObject, merge } from '@lobechat/utils';
import type { PartialDeep } from 'type-fest';

/** Shared by AgentService and execution snapshots: system → server → personal → Agent. */
export const mergeAgentDefaultConfig = (
  agent: Record<string, unknown>,
  options: {
    serverDefault?: PartialDeep<LobeAgentConfig>;
    userDefault?: unknown;
    workspaceId?: string | null;
  },
): LobeAgentConfig => {
  const base = merge(DEFAULT_AGENT_CONFIG, options.serverDefault ?? {});
  // Shared Agents must never inherit the requesting member's personal defaults.
  const userConfig = options.workspaceId
    ? {}
    : ((options.userDefault as { config?: PartialDeep<LobeAgentConfig> } | undefined)?.config ??
      {});
  return merge(merge(base, userConfig), cleanObject(agent));
};
