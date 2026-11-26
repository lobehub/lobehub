import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { type AgentPluginEntry, type LobeAgentConfig, resolveToolMode } from '@lobechat/types';
import { cleanObject, merge } from '@lobechat/utils';
import { isRecord } from '@lobechat/utils/object';
import type { PartialDeep } from 'type-fest';

import type { NewAgent } from '../schemas';

/** Seed the picker's on-demand choices once, when creating an ordinary agent. */
export const getNewAgentPlugins = (
  config: Pick<
    NewAgent,
    'agencyConfig' | 'chatConfig' | 'marketIdentifier' | 'params' | 'plugins' | 'virtual'
  >,
): AgentPluginEntry[] | null | undefined => {
  if (
    config.plugins !== undefined ||
    config.virtual ||
    config.marketIdentifier ||
    (isRecord(config.params) && config.params.forkedFromIdentifier) ||
    config.agencyConfig?.heterogeneousProvider ||
    resolveToolMode(config.chatConfig) !== 'agent'
  )
    return config.plugins;

  return [
    { identifier: 'lobe-image-generation', mode: 'auto' },
    { identifier: 'lobe-video-generation', mode: 'auto' },
    { identifier: 'lobe-agent-documents', mode: 'auto' },
    { identifier: 'lobe-agent', mode: 'auto' },
  ];
};

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
