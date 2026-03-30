import type { UpdateAgentConfigParams } from '@lobechat/builtin-tool-agent-builder';
import type { LobeAgentConfig, MetaData } from '@lobechat/types';

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
  createGroup: 'createGroup',

  // Agent info
  getAgentInfo: 'getAgentInfo',

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

export interface GetAgentInfoParams {
  /**
   * The ID of the agent to get information about
   */
  agentId: string;
}

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

export interface CreateGroupParams {
  /**
   * An emoji or image URL for the group's avatar
   */
  avatar?: string;
  /**
   * Background color for the group avatar
   */
  backgroundColor?: string;
  /**
   * A brief description of the group
   */
  description?: string;
  /**
   * Opening message shown when starting a new conversation with the group
   */
  openingMessage?: string;
  /**
   * Suggested opening questions for the group
   */
  openingQuestions?: string[];
  /**
   * Shared prompt/content for the group
   */
  prompt?: string;
  /**
   * Initial supervisor configuration to apply after group creation
   */
  supervisor?: {
    /**
     * Supervisor avatar
     */
    avatar?: string;
    /**
     * Background color for the supervisor avatar
     */
    backgroundColor?: string;
    /**
     * Supervisor description
     */
    description?: string;
    /**
     * AI model for the supervisor
     */
    model?: string;
    /**
     * Model parameters for the supervisor
     */
    params?: Partial<LobeAgentConfig['params']>;
    /**
     * AI provider for the supervisor
     */
    provider?: string;
    /**
     * Supervisor system prompt
     */
    systemRole?: string;
    /**
     * Supervisor tags
     */
    tags?: string[];
    /**
     * Supervisor display name/title
     */
    title?: string;
  };
  /**
   * The display name for the new group
   */
  title: string;
}

export interface CreateGroupState {
  /**
   * The created group's ID
   */
  groupId: string;
  /**
   * Whether the operation was successful
   */
  success: boolean;
  /**
   * The created supervisor agent's ID
   */
  supervisorAgentId: string;
  /**
   * The created group's title
   */
  title: string;
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
   * The group ID to update. If not provided, updates the current active group.
   */
  groupId?: string;
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
   * The group ID to update. If not provided, updates the current active group.
   */
  groupId?: string;
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
   * Agent avatar (emoji or URL)
   */
  agentAvatar?: string;
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
   * Agent avatar (emoji or URL)
   */
  agentAvatar?: string;
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
