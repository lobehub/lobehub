/**
 * Tool detection status
 */
export interface ToolStatus {
  available: boolean;
  error?: string;
  lastChecked?: Date;
  path?: string;
  version?: string;
}

/**
 * Tool categories
 */
export type ToolCategory = 'content-search' | 'custom' | 'file-search' | 'system';

/**
 * Tool info for display
 */
export interface ToolInfo {
  description?: string;
  name: string;
  priority?: number;
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
