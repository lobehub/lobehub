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

/**
 * The personal layer of an Agent's config: the user's `defaultAgent.config`,
 * minus settings that are per-Agent only. `chatConfig.disableGatewayMode` was a
 * global switch; it is now set on each Agent, so a stale personal value (or one
 * an older client still writes) must not leak into Agents that never set it.
 */
export const getUserDefaultAgentLayer = (userDefault: unknown): PartialDeep<LobeAgentConfig> => {
  const config =
    (userDefault as { config?: PartialDeep<LobeAgentConfig> } | undefined)?.config ?? {};
  if (!isRecord(config.chatConfig) || !('disableGatewayMode' in config.chatConfig)) return config;

  const { disableGatewayMode: _retired, ...chatConfig } = config.chatConfig;
  return { ...config, chatConfig };
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
  const userConfig = options.workspaceId ? {} : getUserDefaultAgentLayer(options.userDefault);
  return merge(merge(base, userConfig), cleanObject(agent));
};
