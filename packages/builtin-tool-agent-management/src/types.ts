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

  
  
  


// ==================== Search ====================
/** Search agents (user's own and marketplace) */
searchAgent: 'searchAgent',

  
  
  

/** Update an existing agent */
updateAgent: 'updateAgent',
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
   * Task title (required when runAsTask is true)
   */
  taskTitle?: string;
  /**
   * Timeout in milliseconds for task execution (default: 1800000 = 30 minutes)
   */
  timeout?: number;
  /**
   * If true (and in a group context), skip calling supervisor after agent responds.
   * Only relevant when used within agent groups. Default: false
   */
  skipCallSupervisor?: boolean;
}

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
   * Task ID if running as background task
   */
  taskId?: string;
  /**
   * Whether to skip calling supervisor after agent responds (only relevant in group context)
   */
  skipCallSupervisor?: boolean;
}
