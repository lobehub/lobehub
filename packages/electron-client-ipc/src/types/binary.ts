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

export type HeterogeneousCliAgentType = 'amp' | 'claude-code' | 'codex' | 'opencode';

export interface DetectHeterogeneousAgentCommandParams {
  agentType: HeterogeneousCliAgentType;
  command: string;
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
