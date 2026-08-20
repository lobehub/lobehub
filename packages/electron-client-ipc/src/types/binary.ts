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
export type BinaryCategory = 'content-search' | 'custom' | 'file-search' | 'system';

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
}

/**
 * Result of checking whether a CLI binary has an update available on npm.
 */
export interface BinaryUpdateInfo {
  latestVersion?: string;
  updateAvailable: boolean;
  upgradeCommand?: string;
}

/**
 * Parameters for checking a single binary for updates.
 */
export interface CheckBinaryUpdateParams {
  currentVersion: string;
  name: string;
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
