import type {
  HeterogeneousAgentType,
  LocalHeterogeneousAgentType,
  RemoteHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import {
  isRemoteHeterogeneousType,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from '@lobechat/heterogeneous-agents';
import { HETEROGENEOUS_AGENT_CLIENT_CONFIGS } from '@lobechat/heterogeneous-agents/client';
import {
  Amp,
  ClaudeCode,
  CodeBuddy,
  Codex,
  Cursor,
  HermesAgent,
  Kimi,
  OpenClaw,
  OpenCode,
  Pi,
  Qoder,
} from '@lobehub/icons';

/**
 * One row in the connect wizard's agent inventory. `kind` mirrors the domain
 * split: `cli` agents use stream adapters, while `platform` agents use the
 * notify-based task runner on this desktop or a bound device.
 */
export interface ConnectableProvider {
  /** CDN avatar to stamp on created cli agents (platform agents use the device profile's). */
  avatar?: string;
  /** Compound brand icon module — render via `icon.Avatar`. */
  brand:
    | typeof Amp
    | typeof ClaudeCode
    | typeof CodeBuddy
    | typeof Codex
    | typeof Cursor
    | typeof HermesAgent
    | typeof Kimi
    | typeof OpenClaw
    | typeof OpenCode
    | typeof Pi
    | typeof Qoder;
  /** Spawn command — cli providers only. */
  command?: string;
  kind: 'cli' | 'platform';
  title: string;
  type: HeterogeneousAgentType;
}

export interface ConnectAgentProfile {
  avatar?: string;
  description?: string;
  title?: string;
}

interface BuildConnectAgentConfigOptions {
  overrides?: { description?: string; name?: string };
  profile?: ConnectAgentProfile;
  provider: ConnectableProvider;
  target: { deviceId: string; kind: 'device' } | { kind: 'local' };
}

const CLI_BRANDS: Record<LocalHeterogeneousAgentType, ConnectableProvider['brand']> = {
  'amp': Amp,
  'claude-code': ClaudeCode,
  'codebuddy': CodeBuddy,
  'codex': Codex,
  'cursor': Cursor,
  'kimi-code': Kimi,
  'opencode': OpenCode,
  'pi': Pi,
  'qoder': Qoder,
};

const PLATFORM_BRANDS: Record<RemoteHeterogeneousAgentType, ConnectableProvider['brand']> = {
  hermes: HermesAgent,
  openclaw: OpenClaw,
};

export const CONNECTABLE_PROVIDERS: ConnectableProvider[] = [
  ...HETEROGENEOUS_AGENT_CLIENT_CONFIGS.map((config) => ({
    avatar: config.avatar,
    brand: CLI_BRANDS[config.type],
    command: config.defaultCommand,
    kind: 'cli' as const,
    title: config.title,
    type: config.type,
  })),
  ...REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((config) => ({
    brand: PLATFORM_BRANDS[config.type],
    kind: 'platform' as const,
    title: config.title,
    type: config.type,
  })),
];

export const getConnectableProvider = (type: HeterogeneousAgentType) =>
  CONNECTABLE_PROVIDERS.find((provider) => provider.type === type);

export const buildPlatformAgencyConfig = (
  type: RemoteHeterogeneousAgentType,
  target: { deviceId: string; kind: 'device' } | { kind: 'local' },
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
      title: profile?.title || provider.title,
    };
  }

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
        heterogeneousProvider: { command: provider.command, type: provider.type },
      },
    };
  }

  return {
    ...base,
    agencyConfig: {
      heterogeneousProvider: { command: provider.command, type: provider.type },
    },
  };
};
