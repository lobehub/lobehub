import type { IconType } from '@lobehub/icons';
import {
  Amp,
  ClaudeCode,
  CodeBuddy,
  Codex,
  Cursor,
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
  isRemoteHeterogeneousType,
} from '../config';
import { DROID_AVATAR_URL, DroidIcon } from './DroidIcon';

export { DROID_AVATAR_URL, DroidIcon, isRemoteHeterogeneousType };

export type HeterogeneousAgentClientConfig = (typeof HETEROGENEOUS_AGENT_CONFIGS)[number] & {
  avatar: string;
  icon: IconType;
};

const heterogeneousAgentIcons = {
  'amp': Amp,
  'claude-code': ClaudeCode,
  'codebuddy': CodeBuddy,
  'codex': Codex,
  'cursor': Cursor,
  'droid': DroidIcon,
  'grok-build': Grok,
  'kimi-code': Kimi,
  'opencode': OpenCode,
  'pi': Pi,
  'qoder': Qoder,
  'trae': Trae,
} as const satisfies Record<HeterogeneousAgentClientConfig['type'], IconType>;

const createAgentAvatar = (iconId: string) =>
  iconId === 'Droid'
    ? DROID_AVATAR_URL
    : getLobeIconCDN(iconId, {
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
