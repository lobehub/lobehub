import type { IconType } from '@lobehub/icons';
import { Amp, ClaudeCode, Codex, getLobeIconCDN, OpenCode, Pi, Qoder } from '@lobehub/icons';

import {
  getHeterogeneousAgentConfig,
  HETEROGENEOUS_AGENT_CONFIGS,
  isRemoteHeterogeneousType,
} from '../config';

export { isRemoteHeterogeneousType };

export type HeterogeneousAgentClientConfig = (typeof HETEROGENEOUS_AGENT_CONFIGS)[number] & {
  avatar: string;
  icon: IconType;
};

const heterogeneousAgentIcons = {
  'amp': Amp,
  'claude-code': ClaudeCode,
  'codex': Codex,
  'opencode': OpenCode,
  'pi': Pi,
  'qoder': Qoder,
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

export const getHeterogeneousAgentClientConfig = (type: string) => {
  const config = getHeterogeneousAgentConfig(type);

  if (!config) return undefined;

  return {
    ...config,
    avatar: createAgentAvatar(config.iconId),
    icon: heterogeneousAgentIcons[config.type as keyof typeof heterogeneousAgentIcons],
  } satisfies HeterogeneousAgentClientConfig;
};
