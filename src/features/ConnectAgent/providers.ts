import type {
  HeterogeneousAgentType,
  LocalHeterogeneousAgentType,
  LocalRuntimeHeterogeneousAgentType,
  RemoteHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import { DroidIcon } from '@lobechat/heterogeneous-agents/client';
import type { ConnectableAgentDescriptor } from '@lobechat/heterogeneous-agents/connectAgent';
import { CONNECTABLE_AGENT_DESCRIPTORS } from '@lobechat/heterogeneous-agents/connectAgent';
import {
  Amp,
  Antigravity,
  ClaudeCode,
  CodeBuddy,
  Codex,
  Cursor,
  DeepSeek,
  Devin,
  GithubCopilot,
  Grok,
  HermesAgent,
  Kimi,
  OpenClaw,
  OpenCode,
  Pi,
  Qoder,
  Trae,
} from '@lobehub/icons';

export type {
  BuildConnectAgentConfigOptions,
  ConnectAgentProfile,
} from '@lobechat/heterogeneous-agents/connectAgent';
export {
  buildConnectAgentConfig,
  buildPlatformAgencyConfig,
} from '@lobechat/heterogeneous-agents/connectAgent';

/**
 * One row in the connect wizard's agent inventory: the shared descriptor plus
 * the brand icon the wizard renders.
 */
export interface ConnectableProvider extends ConnectableAgentDescriptor {
  /** Compound brand icon module — render via `icon.Avatar`. */
  brand:
    | typeof Amp
    | typeof Antigravity
    | typeof ClaudeCode
    | typeof CodeBuddy
    | typeof Codex
    | typeof Cursor
    | typeof DeepSeek
    | typeof DroidIcon
    | typeof Devin
    | typeof GithubCopilot
    | typeof Grok
    | typeof HermesAgent
    | typeof Kimi
    | typeof OpenClaw
    | typeof OpenCode
    | typeof Pi
    | typeof Qoder
    | typeof Trae;
}

const CLI_BRANDS: Record<LocalHeterogeneousAgentType, ConnectableProvider['brand']> = {
  'antigravity': Antigravity,
  'amp': Amp,
  'claude-code': ClaudeCode,
  'codebuddy': CodeBuddy,
  'codex': Codex,
  'copilot': GithubCopilot,
  'cursor': Cursor,
  'droid': DroidIcon,
  'devin': Devin,
  'grok-build': Grok,
  'kimi-code': Kimi,
  'opencode': OpenCode,
  'pi': Pi,
  'qoder': Qoder,
  'trae': Trae,
};

const PLATFORM_BRANDS: Record<RemoteHeterogeneousAgentType, ConnectableProvider['brand']> = {
  hermes: HermesAgent,
  openclaw: OpenClaw,
};

const RUNTIME_BRANDS: Record<LocalRuntimeHeterogeneousAgentType, ConnectableProvider['brand']> = {
  'deepseek-harness': DeepSeek,
};

const BRANDS = {
  ...CLI_BRANDS,
  ...PLATFORM_BRANDS,
  ...RUNTIME_BRANDS,
} satisfies Record<ConnectableAgentDescriptor['type'], ConnectableProvider['brand']>;

export const CONNECTABLE_PROVIDERS: ConnectableProvider[] = CONNECTABLE_AGENT_DESCRIPTORS.map(
  (descriptor) => ({ ...descriptor, brand: BRANDS[descriptor.type] }),
);

export const getConnectableProvider = (type: HeterogeneousAgentType) =>
  CONNECTABLE_PROVIDERS.find((provider) => provider.type === type);
