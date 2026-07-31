import {
  type HeterogeneousAgentType,
  type LocalHeterogeneousAgentType,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
  type RemoteHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import { HETEROGENEOUS_AGENT_CLIENT_CONFIGS } from '@lobechat/heterogeneous-agents/client';
import { Amp, ClaudeCode, Codex, HermesAgent, OpenClaw, OpenCode } from '@lobehub/icons';

/**
 * One row in the connect wizard's agent inventory. `kind` mirrors the domain
 * split: `cli` agents spawn as processes (locally or on a bound device),
 * `platform` agents are always device-bound and reached over the gateway.
 */
export interface ConnectableProvider {
  /** CDN avatar to stamp on created cli agents (platform agents use the device profile's). */
  avatar?: string;
  /** Compound brand icon module — render via `icon.Avatar`. */
  brand:
    | typeof Amp
    | typeof ClaudeCode
    | typeof Codex
    | typeof HermesAgent
    | typeof OpenClaw
    | typeof OpenCode;
  /** Spawn command — cli providers only. */
  command?: string;
  kind: 'cli' | 'platform';
  title: string;
  type: HeterogeneousAgentType;
}

const CLI_BRANDS: Record<LocalHeterogeneousAgentType, ConnectableProvider['brand']> = {
  'amp': Amp,
  'claude-code': ClaudeCode,
  'codex': Codex,
  'opencode': OpenCode,
};

const PLATFORM_BRANDS: Record<RemoteHeterogeneousAgentType, ConnectableProvider['brand']> = {
  hermes: HermesAgent,
  openclaw: OpenClaw,
};

export const CONNECTABLE_PROVIDERS: ConnectableProvider[] = [
  ...HETEROGENEOUS_AGENT_CLIENT_CONFIGS.map((config) => ({
    avatar: config.avatar,
    brand: CLI_BRANDS[config.type],
    command: config.command,
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
