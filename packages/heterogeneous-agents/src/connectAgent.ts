import { getLobeIconCDN } from '@lobehub/icons/es/features/getLobeIconCDN';

import type { HeterogeneousAgentType, RemoteHeterogeneousAgentType } from './config';
import {
  HETEROGENEOUS_AGENT_CONFIGS,
  isRemoteHeterogeneousType,
  LOCAL_RUNTIME_HETEROGENEOUS_AGENT_CONFIGS,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from './config';

/**
 * React-free agent-creation contract shared by the Web "Connect agent" wizard
 * and `lh agent connect`, so both create the same agent row for the same pick.
 * Import it from `@lobechat/heterogeneous-agents/connectAgent`.
 */

export const DROID_AVATAR_URL = 'https://factory.ai/favicon.svg';

export const getHeterogeneousAgentAvatar = (iconId: string) =>
  iconId === 'Droid'
    ? DROID_AVATAR_URL
    : getLobeIconCDN(iconId, {
        cdn: 'aliyun',
        format: 'avatar',
      });

/**
 * One connectable agent. `kind` mirrors the domain split: `cli` agents use
 * stream adapters, `runtime` agents are LobeHub-shipped local runtimes, and
 * `platform` agents use the notify-based task runner on a bound device.
 */
export interface ConnectableAgentDescriptor {
  /** CDN avatar to stamp on created cli agents (platform agents use the device profile's). */
  avatar?: string;
  /** Spawn command — cli and runtime providers. */
  command?: string;
  kind: 'cli' | 'platform' | 'runtime';
  title: string;
  type: HeterogeneousAgentType;
}

export const CONNECTABLE_AGENT_DESCRIPTORS: ConnectableAgentDescriptor[] = [
  ...HETEROGENEOUS_AGENT_CONFIGS.map((config) => ({
    avatar: getHeterogeneousAgentAvatar(config.iconId),
    command: config.defaultCommand,
    kind: 'cli' as const,
    title: config.title,
    type: config.type,
  })),
  ...LOCAL_RUNTIME_HETEROGENEOUS_AGENT_CONFIGS.map((config) => ({
    avatar: getHeterogeneousAgentAvatar(config.iconId),
    command: config.defaultCommand,
    kind: 'runtime' as const,
    title: config.title,
    type: config.type,
  })),
  ...REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((config) => ({
    kind: 'platform' as const,
    title: config.title,
    type: config.type,
  })),
];

export const getConnectableAgentDescriptor = (type: string) =>
  CONNECTABLE_AGENT_DESCRIPTORS.find((descriptor) => descriptor.type === type);

export interface ConnectAgentProfile {
  avatar?: string;
  description?: string;
  title?: string;
}

export type ConnectAgentTarget = { deviceId: string; kind: 'device' } | { kind: 'local' };

export interface BuildConnectAgentConfigOptions {
  overrides?: { description?: string; name?: string };
  profile?: ConnectAgentProfile;
  provider: ConnectableAgentDescriptor;
  target: ConnectAgentTarget;
}

export const buildPlatformAgencyConfig = (
  type: RemoteHeterogeneousAgentType,
  target: ConnectAgentTarget,
) => ({
  ...(target.kind === 'device'
    ? { boundDeviceId: target.deviceId, executionTarget: 'device' as const }
    : undefined),
  heterogeneousProvider: { type },
});

export const buildConnectAgentConfig = ({
  overrides,
  profile,
  provider,
  target,
}: BuildConnectAgentConfigOptions) => {
  const name = overrides?.name?.trim() || undefined;

  if (provider.kind === 'platform' && isRemoteHeterogeneousType(provider.type)) {
    return {
      agencyConfig: buildPlatformAgencyConfig(provider.type, target),
      avatar: profile?.avatar || undefined,
      description: (overrides?.description ?? profile?.description)?.trim() || undefined,
      name,
      // Same stamp as the CLI branch below: readers that attribute a run by the
      // agent's provider (topic model snapshot, agent list, message tags) must
      // see `openclaw`/`hermes`, not the inherited default chat provider.
      provider: provider.type,
      title: profile?.title || provider.title,
    };
  }

  // A runtime's command is only what the scan probes; launch resolves it itself.
  const command = provider.kind === 'cli' ? provider.command : undefined;
  const base = {
    avatar: provider.avatar,
    description: overrides?.description?.trim() || undefined,
    name,
    provider: provider.type,
    systemRole: '',
    title: provider.title,
  };

  if (target.kind === 'device') {
    return {
      ...base,
      agencyConfig: {
        boundDeviceId: target.deviceId,
        executionTarget: 'device' as const,
        heterogeneousProvider: { command, type: provider.type },
      },
    };
  }

  return {
    ...base,
    agencyConfig: {
      heterogeneousProvider: { command, type: provider.type },
    },
  };
};

/**
 * Default name of a connected agent: the product title, owner-prefixed for a
 * workspace agent members can see ("Arvin’s Codex"), so a shared sidebar tells
 * apart the same CLI connected by different people.
 */
export const connectedAgentDefaultName = ({
  ownerName,
  productTitle,
  visibility,
  workspaceId,
}: {
  ownerName?: string | null;
  productTitle?: string;
  visibility?: 'private' | 'public';
  workspaceId?: string | null;
}): string | undefined => {
  const product = productTitle?.trim();
  if (!product) return undefined;
  if (!workspaceId || visibility === 'private') return product;

  const owner = ownerName?.trim();
  return owner ? `${owner}’s ${product}` : product;
};
