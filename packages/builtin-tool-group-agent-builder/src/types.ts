import type { MetaData } from '@lobechat/types';

/**
 * Group Agent Builder Tool Identifier
 */
export const GroupAgentBuilderIdentifier = 'lobe-group-agent-builder';

/**
 * Group Agent Builder API Names
 */
export const GroupAgentBuilderApiName = {
  // Read operations (inherited from AgentBuilder)
  getAvailableModels: 'getAvailableModels',
  // Write operations (inherited from AgentBuilder)
  installPlugin: 'installPlugin',

  // Group-specific operations
  inviteAgent: 'inviteAgent',

  removeAgent: 'removeAgent',

  searchMarketTools: 'searchMarketTools',

  updateAgentConfig: 'updateConfig',
  // Group config operations
  updateGroupConfig: 'updateGroupConfig',
  updatePrompt: 'updatePrompt',
} as const;

export type GroupAgentBuilderApiNameType =
  (typeof GroupAgentBuilderApiName)[keyof typeof GroupAgentBuilderApiName];

// ============== Group-specific Parameter Types ==============

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

export interface UpdateGroupPromptParams {
  /**
   * The new system prompt content for the group (markdown format)
   */
  prompt: string;
  /**
   * Whether to use streaming mode for typewriter effect
   */
  streaming?: boolean;
}

export interface UpdateGroupMetaParams {
  /**
   * Partial metadata to update for the group
   */
  meta?: Partial<Pick<MetaData, 'title' | 'description' | 'avatar' | 'backgroundColor' | 'tags'>>;
}

// ============== State Types (for Render components) ==============

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

export interface UpdateGroupPromptState {
  newPrompt: string;
  previousPrompt?: string;
  success: boolean;
}

// ============== Group Config Types ==============

export interface UpdateGroupConfigParams {
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
}

export interface UpdateGroupConfigState {
  /**
   * Whether the operation was successful
   */
  success: boolean;
  /**
   * The updated configuration values
   */
  updatedConfig: {
    openingMessage?: string;
    openingQuestions?: string[];
  };
}
