import type { LobeAgentConfig, MetaData } from '@lobechat/types';
import type { PartialDeep } from 'type-fest';

/**
 * Agent Management Tool Identifier
 */
export const AgentManagementIdentifier = 'lobe-agent-management';

/**
 * Agent Management API Names
 */
export const AgentManagementApiName = {
  // ==================== Execution ====================
  /** Call an agent to handle a task */
  callAgent: 'callAgent',

  // ==================== Agent CRUD ====================
  /** Create a new agent */
  createAgent: 'createAgent',

  /** Delete an agent */
  deleteAgent: 'deleteAgent',

  /** Duplicate an existing agent */
  duplicateAgent: 'duplicateAgent',

  /** Get detailed configuration of an agent */
  getAgentDetail: 'getAgentDetail',

  /** Install a plugin for an agent */
  installPlugin: 'installPlugin',

  // ==================== Search ====================
  /** Search agents (user's own and marketplace) */
  searchAgent: 'searchAgent',

  /** Update an existing agent */
  updateAgent: 'updateAgent',

  /** Update an agent's system prompt */
  updatePrompt: 'updatePrompt',
} as const;

export type AgentManagementApiNameType =
  (typeof AgentManagementApiName)[keyof typeof AgentManagementApiName];

// ==================== Create Agent ====================

export interface CreateAgentParams {
  /**
   * Agent avatar (emoji or image URL)
   */
  avatar?: string;
  /**
   * Background color for the agent card
   */
  backgroundColor?: string;
  /**
   * Agent description
   */
  description?: string;
  /**
   * AI model to use (e.g., "gpt-4o", "claude-3-5-sonnet")
   */
  model?: string;
  /**
   * Opening message for new conversations
   */
  openingMessage?: string;
  /**
   * Suggested opening questions
   */
  openingQuestions?: string[];
  /**
   * Enabled plugins
   */
  plugins?: string[];
  /**
   * AI provider (e.g., "openai", "anthropic")
   */
  provider?: string;
  /**
   * System prompt that defines the agent's behavior
   */
  systemRole?: string;
  /**
   * Tags for categorization
   */
  tags?: string[];
  /**
   * Agent display name/title
   */
  title: string;
}

export interface CreateAgentState {
  /**
   * The created agent's ID
   */
  agentId?: string;
  /**
   * Error message if creation failed
   */
  error?: string;
  /**
   * The associated session ID
   */
  sessionId?: string;
  /**
   * Whether the creation was successful
   */
  success: boolean;
}

// ==================== Update Agent ====================

export interface UpdateAgentParams {
  /**
   * The agent ID to update
   */
  agentId: string;
  /**
   * Partial agent configuration to update
   */
  config?: PartialDeep<LobeAgentConfig>;
  /**
   * Partial metadata to update
   */
  meta?: Partial<MetaData>;
}

export interface UpdateAgentState {
  /**
   * The agent ID that was updated
   */
  agentId: string;
  /**
   * Updated configuration fields
   */
  config?: {
    newValues: Record<string, unknown>;
    previousValues: Record<string, unknown>;
    updatedFields: string[];
  };
  /**
   * Updated metadata fields
   */
  meta?: {
    newValues: Partial<MetaData>;
    previousValues: Partial<MetaData>;
    updatedFields: string[];
  };
  /**
   * Whether the update was successful
   */
  success: boolean;
}

// ==================== Delete Agent ====================

export interface DeleteAgentParams {
  /**
   * The agent ID to delete
   */
  agentId: string;
}

export interface DeleteAgentState {
  /**
   * The deleted agent ID
   */
  agentId: string;
  /**
   * Whether the deletion was successful
   */
  success: boolean;
}

// ==================== Search Agent ====================

export type SearchAgentSource = 'user' | 'market' | 'all';

export interface SearchAgentParams {
  /**
   * Category filter for marketplace search
   */
  category?: string;
  /**
   * Search keywords
   */
  keyword?: string;
  /**
   * Maximum number of results (default: 10)
   */
  limit?: number;
  /**
   * Search source: 'user' (own agents), 'market' (marketplace), 'all' (both)
   */
  source?: SearchAgentSource;
}

export interface AgentSearchItem {
  /**
   * Agent avatar
   */
  avatar?: string;
  /**
   * Background color
   */
  backgroundColor?: string;
  /**
   * Agent description
   */
  description?: string;
  /**
   * Agent ID (for user agents) or identifier (for market agents)
   */
  id: string;
  /**
   * Whether this is a marketplace agent
   */
  isMarket?: boolean;
  /**
   * Agent title
   */
  title?: string;
}

export interface SearchAgentState {
  /**
   * List of matching agents
   */
  agents: AgentSearchItem[];
  /**
   * The search keyword used
   */
  keyword?: string;
  /**
   * The search source used
   */
  source: SearchAgentSource;
  /**
   * Total count of matching agents
   */
  totalCount: number;
}

// ==================== Update Prompt ====================

export interface UpdatePromptParams {
  /**
   * The agent ID to update the prompt for
   */
  agentId: string;
  /**
   * The new system prompt content
   */
  prompt: string;
}

// ==================== Call Agent ====================

export interface CallAgentParams {
  /**
   * The agent ID to call
   */
  agentId: string;
  /**
   * Instruction or task for the agent to execute
   */
  instruction: string;
  /**
   * If true, execute as an async background task
   */
  runAsTask?: boolean;
  /**
   * If true (and in a group context), skip calling supervisor after agent responds.
   * Only relevant when used within agent groups. Default: false
   */
  skipCallSupervisor?: boolean;
  /**
   * Task title (required when runAsTask is true)
   */
  taskTitle?: string;
  /**
   * Timeout in milliseconds for task execution (default: 1800000 = 30 minutes)
   */
  timeout?: number;
}

// ==================== Get Agent Detail ====================

export interface GetAgentDetailParams {
  /**
   * The agent ID to get details for
   */
  agentId: string;
}

export interface GetAgentDetailState {
  /**
   * The agent ID
   */
  agentId: string;
  /**
   * Agent configuration
   */
  config?: {
    model?: string;
    openingMessage?: string;
    openingQuestions?: string[];
    plugins?: string[];
    provider?: string;
    systemRole?: string;
  };
  /**
   * Agent metadata
   */
  meta?: {
    avatar?: string;
    backgroundColor?: string;
    description?: string;
    tags?: string[];
    title?: string;
  };
  /**
   * Whether the retrieval was successful
   */
  success: boolean;
}

// ==================== Duplicate Agent ====================

export interface DuplicateAgentParams {
  /**
   * The agent ID to duplicate
   */
  agentId: string;
  /**
   * Optional new title for the duplicated agent
   */
  newTitle?: string;
}

export interface DuplicateAgentState {
  /**
   * The new agent's ID
   */
  newAgentId?: string;
  /**
   * The original agent ID
   */
  sourceAgentId: string;
  /**
   * Whether the duplication was successful
   */
  success: boolean;
}

// ==================== Install Plugin ====================

export type InstallPluginSource = 'official' | 'market';

export interface InstallPluginParams {
  /**
   * The agent ID to install the plugin for
   */
  agentId: string;
  /**
   * The plugin identifier to install
   */
  identifier: string;
  /**
   * Plugin source: 'official' (builtin/klavis/lobehub-skill) or 'market' (MCP marketplace)
   */
  source: InstallPluginSource;
}

export interface InstallPluginState {
  /**
   * Whether the plugin was installed successfully
   */
  installed: boolean;
  /**
   * The plugin identifier
   */
  pluginId: string;
  /**
   * The plugin display name
   */
  pluginName?: string;
  /**
   * Whether the operation was successful
   */
  success: boolean;
}

// ==================== Call Agent ====================

export interface CallAgentState {
  /**
   * The agent ID being called
   */
  agentId: string;
  /**
   * The instruction given
   */
  instruction: string;
  /**
   * Execution mode
   */
  mode: 'speak' | 'task';
  /**
   * Whether to skip calling supervisor after agent responds (only relevant in group context)
   */
  skipCallSupervisor?: boolean;
  /**
   * Task ID if running as background task
   */
  taskId?: string;
}
