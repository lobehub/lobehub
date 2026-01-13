import type { UpdateAgentConfigParams } from '@lobechat/builtin-tool-agent-builder';
import type { MetaData } from '@lobechat/types';

/**
 * Group Agent Builder Tool Identifier
 */
export const GroupAgentBuilderIdentifier = 'lobe-group-agent-builder';

/**
 * Group Agent Builder API Names
 */
export const GroupAgentBuilderApiName = {
  // Group member management operations
  batchCreateAgents: 'batchCreateAgents',
  createAgent: 'createAgent',

  // Read operations (inherited from AgentBuilder)
  getAvailableModels: 'getAvailableModels',

  // Write operations (inherited from AgentBuilder)
  installPlugin: 'installPlugin',

  inviteAgent: 'inviteAgent',

  removeAgent: 'removeAgent',

  searchAgent: 'searchAgent',

  searchMarketTools: 'searchMarketTools',

  updateAgentConfig: 'updateConfig',
  // Group operations
  updateAgentPrompt: 'updateAgentPrompt',
  updateGroup: 'updateGroup',
  updateGroupPrompt: 'updateGroupPrompt',
} as const;

export type GroupAgentBuilderApiNameType =
  (typeof GroupAgentBuilderApiName)[keyof typeof GroupAgentBuilderApiName];

// ============== Group-specific Parameter Types ==============

export interface SearchAgentParams {
  /**
   * Maximum number of results to return
   */
  limit?: number;
  /**
   * Search query to find agents by name or description
   */
  query?: string;
}

export interface CreateAgentParams {
  /**
   * An emoji or image URL for the agent's avatar
   */
  avatar?: string;
  /**
   * A brief description of what this agent does
   */
  description?: string;
  /**
   * The system prompt that defines the agent's behavior
   */
  systemRole: string;
  /**
   * The display name for the new agent
   */
  title: string;
  /**
   * List of tool identifiers to enable for this agent.
   * Use the same identifiers as shown in official_tools context.
   */
  tools?: string[];
}

export interface InviteAgentParams {
  /**
   * Agent identifier to invite to the group
   */
  agentId: string;
}

export interface RemoveAgentParams {
  /**
   * Agent identifier to remove from the group
   */
  agentId: string;
}

export interface UpdateAgentPromptParams {
  /**
   * The agent ID to update
   */
  agentId: string;
  /**
   * The new system prompt content (markdown format)
   */
  prompt: string;
}

export interface UpdateAgentPromptState {
  /**
   * The agent ID that was updated
   */
  agentId: string;
  /**
   * The new prompt
   */
  newPrompt: string;
  /**
   * The previous prompt
   */
  previousPrompt?: string;
  /**
   * Whether the operation was successful
   */
  success: boolean;
}

/**
 * Extended UpdateAgentConfigParams with optional agentId for group context
 */
export interface UpdateAgentConfigWithIdParams extends UpdateAgentConfigParams {
  /**
   * The agent ID to update. If not provided, updates the supervisor agent.
   */
  agentId?: string;
}

/**
 * Unified params for updating group (combines config and meta)
 */
export interface UpdateGroupParams {
  /**
   * Partial group configuration to update
   */
  config?: {
    /**
     * Opening message shown when starting a new conversation with the group
     */
    openingMessage?: string;
    /**
     * Suggested opening questions to help users get started
     */
    openingQuestions?: string[];
  };
  /**
   * Partial metadata to update for the group
   */
  meta?: Partial<Pick<MetaData, 'avatar' | 'backgroundColor' | 'description' | 'tags' | 'title'>>;
}

export interface UpdateGroupState {
  /**
   * Whether the operation was successful
   */
  success: boolean;
  /**
   * The updated configuration values
   */
  updatedConfig?: {
    openingMessage?: string;
    openingQuestions?: string[];
  };
  /**
   * The updated metadata values
   */
  updatedMeta?: Partial<
    Pick<MetaData, 'avatar' | 'backgroundColor' | 'description' | 'tags' | 'title'>
  >;
}

export interface UpdateGroupPromptParams {
  /**
   * The new shared prompt/content for the group (markdown format)
   */
  prompt: string;
  /**
   * Whether to use streaming mode for typewriter effect
   */
  streaming?: boolean;
}

export interface UpdateGroupPromptState {
  /**
   * The new prompt
   */
  newPrompt: string;
  /**
   * The previous prompt
   */
  previousPrompt?: string;
  /**
   * Whether the operation was successful
   */
  success: boolean;
}

export interface BatchCreateAgentsParams {
  /**
   * Array of agents to create
   */
  agents: CreateAgentParams[];
}

export interface BatchCreateAgentsState {
  /**
   * Created agents info
   */
  agents: Array<{
    agentId: string;
    success: boolean;
    title: string;
  }>;
  /**
   * Number of agents that failed to create
   */
  failedCount: number;
  /**
   * Number of agents successfully created
   */
  successCount: number;
}

// ============== State Types (for Render components) ==============

export interface SearchAgentResult {
  avatar?: string;
  description?: string;
  id: string;
  title: string;
}

export interface SearchAgentState {
  agents: SearchAgentResult[];
  query?: string;
  total: number;
}

export interface CreateAgentState {
  /**
   * The ID of the created agent
   */
  agentId: string;
  /**
   * Whether the operation was successful
   */
  success: boolean;
  /**
   * The title of the created agent
   */
  title: string;
}

export interface InviteAgentState {
  /**
   * Agent identifier that was invited
   */
  agentId: string;
  /**
   * Agent display name
   */
  agentName?: string;
  /**
   * Whether the operation was successful
   */
  success: boolean;
}

export interface RemoveAgentState {
  /**
   * Agent identifier that was removed
   */
  agentId: string;
  /**
   * Agent display name
   */
  agentName?: string;
  /**
   * Whether the operation was successful
   */
  success: boolean;
}
