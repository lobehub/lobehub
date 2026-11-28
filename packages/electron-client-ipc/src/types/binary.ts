import type {
  HeterogeneousAgentType,
  LocalHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';

/**
 * Status of a registered binary
 */
export interface BinaryStatus {
  available: boolean;
  error?: string;
  lastChecked?: Date;
  path?: string;
  version?: string;
}

/**
 * Binary categories
 */
export type BinaryCategory =
  | 'ast-search'
  | 'browser-automation'
  | 'cli-agents'
  | 'content-search'
  | 'custom'
  | 'file-search'
  | 'runtime-environment'
  | 'system';

/**
 * Binary info for display
 */
export interface BinaryInfo {
  description?: string;
  name: string;
  priority?: number;
}

export type HeterogeneousCliAgentType = LocalHeterogeneousAgentType;

export type DetectableHeterogeneousAgentType = HeterogeneousAgentType;

export interface DetectHeterogeneousAgentCommandParams {
  agentType: DetectableHeterogeneousAgentType;
  command: string;
  /**
   * Set when this check is one agent of a list scan. The environment (PATH,
   * WSL) is refreshed once for the scan instead of once per agent, and unless
   * `rescan` is set, WSL is only searched in distros that are already running
   * so opening a list never boots WSL's VM. Omit for a one-off check.
   */
  scan?: { id: string; rescan?: boolean };
}

/**
 * Claude Code CLI auth status (from `claude auth status --json`)
 */
export interface ClaudeAuthStatus {
  apiProvider?: string;
  authMethod?: string;
  email?: string;
  loggedIn: boolean;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}
