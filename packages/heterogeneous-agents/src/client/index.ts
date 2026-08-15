import type { IconType } from '@lobehub/icons';
import {
  Amp,
  ClaudeCode,
  CodeBuddy,
  Codex,
  Cursor,
  DeepSeek,
  getLobeIconCDN,
  Grok,
  Kimi,
  OpenCode,
  Pi,
  Qoder,
  Trae,
} from '@lobehub/icons';

import {
  getHeterogeneousAgentConfig,
  HETEROGENEOUS_AGENT_CONFIGS,
  isLocalRuntimeHeterogeneousType,
  isRemoteHeterogeneousType,
  LOCAL_RUNTIME_HETEROGENEOUS_AGENT_CONFIGS,
} from '../config';

export { isLocalRuntimeHeterogeneousType, isRemoteHeterogeneousType };

export type HeterogeneousAgentClientConfig = (typeof HETEROGENEOUS_AGENT_CONFIGS)[number] & {
  avatar: string;
  icon: IconType;
};

export type LocalRuntimeHeterogeneousAgentClientConfig =
  (typeof LOCAL_RUNTIME_HETEROGENEOUS_AGENT_CONFIGS)[number] & {
    avatar: string;
    icon: IconType;
  };

const heterogeneousAgentIcons = {
  'amp': Amp,
  'claude-code': ClaudeCode,
  'codebuddy': CodeBuddy,
  'codex': Codex,
  'cursor': Cursor,
  'grok-build': Grok,
  'kimi-code': Kimi,
  'opencode': OpenCode,
  'pi': Pi,
  'qoder': Qoder,
  'trae': Trae,
} as const satisfies Record<HeterogeneousAgentClientConfig['type'], IconType>;

const createAgentAvatar = (iconId: string) =>
  getLobeIconCDN(iconId, {
    cdn: 'aliyun',
    format: 'avatar',
  });

export const HETEROGENEOUS_AGENT_CLIENT_CONFIGS = HETEROGENEOUS_AGENT_CONFIGS.map((config) => ({
  ...config,
  avatar: createAgentAvatar(config.iconId),
  icon: heterogeneousAgentIcons[config.type],
})) as readonly HeterogeneousAgentClientConfig[];

export const LOCAL_RUNTIME_HETEROGENEOUS_AGENT_CLIENT_CONFIGS =
  LOCAL_RUNTIME_HETEROGENEOUS_AGENT_CONFIGS.map((config) => ({
    ...config,
    avatar: createAgentAvatar(config.iconId),
    icon: DeepSeek,
  })) as readonly LocalRuntimeHeterogeneousAgentClientConfig[];

export const getHeterogeneousAgentClientConfig = (type: string) => {
  const config = getHeterogeneousAgentConfig(type);

  if (!config) {
    return LOCAL_RUNTIME_HETEROGENEOUS_AGENT_CLIENT_CONFIGS.find((item) => item.type === type);
  }

  return {
    ...config,
    avatar: createAgentAvatar(config.iconId),
    icon: heterogeneousAgentIcons[config.type as keyof typeof heterogeneousAgentIcons],
  } satisfies HeterogeneousAgentClientConfig;
};
