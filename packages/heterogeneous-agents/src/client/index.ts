import type { IconType } from '@lobehub/icons';
import { ClaudeCode, Codex, getLobeIconCDN } from '@lobehub/icons';

import {
  getHeterogeneousAgentConfig,
  HETEROGENEOUS_AGENT_CONFIGS,
  type HeterogeneousAgentConfig,
} from '../config';

export interface HeterogeneousAgentClientConfig extends HeterogeneousAgentConfig {
  avatar: string;
  icon: IconType;
}

const heterogeneousAgentIcons = {
  'claude-code': ClaudeCode,
  'codex': Codex,
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

export const getHeterogeneousAgentClientConfig = (type: HeterogeneousAgentConfig['type']) => {
  const config = getHeterogeneousAgentConfig(type);

  if (!config) return undefined;

  return {
    ...config,
    avatar: createAgentAvatar(config.iconId),
    icon: heterogeneousAgentIcons[config.type],
  } satisfies HeterogeneousAgentClientConfig;
};
