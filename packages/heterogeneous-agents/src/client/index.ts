import type { IconType } from '@lobehub/icons';
import { Amp, ClaudeCode, Codex, getLobeIconCDN, OpenCode } from '@lobehub/icons';

import {
  getHeterogeneousAgentConfig,
  HETEROGENEOUS_AGENT_CONFIGS,
  type HeterogeneousAgentConfig,
  isRemoteHeterogeneousType,
} from '../config';

export { isRemoteHeterogeneousType };

export interface HeterogeneousAgentClientConfig extends HeterogeneousAgentConfig {
  avatar: string;
  icon: IconType;
}

const heterogeneousAgentIcons = {
  'amp': Amp,
  'claude-code': ClaudeCode,
  'codex': Codex,
  'opencode': OpenCode,
} as const satisfies Record<HeterogeneousAgentConfig['type'], IconType>;

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

export const getHeterogeneousAgentClientConfig = (type: string) => {
  const config = getHeterogeneousAgentConfig(type);

  if (!config) return undefined;

  return {
    ...config,
    avatar: createAgentAvatar(config.iconId),
    icon: heterogeneousAgentIcons[config.type as keyof typeof heterogeneousAgentIcons],
  } satisfies HeterogeneousAgentClientConfig;
};
