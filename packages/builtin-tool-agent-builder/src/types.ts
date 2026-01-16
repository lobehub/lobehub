import type { LobeAgentConfig, MetaData } from '@lobechat/types';
import type { PartialDeep } from 'type-fest';

/**
 * Agent Builder Tool Identifier
 */
export const AgentBuilderIdentifier = 'lobe-agent-builder';

/**
 * Agent Builder API Names
 */
export const AgentBuilderApiName = {
  // Read operations
  // Note: getAgentConfig, getAgentMeta, getPrompt, getAvailableTools, searchOfficialTools are removed
  // because the current agent context is now automatically injected
  getAvailableModels: 'getAvailableModels',
  installPlugin: 'installPlugin',
  searchMarketTools: 'searchMarketTools',
  // Write operations
  // Note: setModel, setOpeningMessage, setOpeningQuestions, updateChatConfig, updateAgentMeta, togglePlugin are removed
  // and consolidated into updateAgentConfig
  updateAgentConfig: 'updateConfig',
  updatePrompt: 'updatePrompt',
} as const;

export type AgentBuilderApiNameType =
  (typeof AgentBuilderApiName)[keyof typeof AgentBuilderApiName];

// ============== Parameter Types ==============

export interface UpdateAgentConfigParams {
  /**
   * Partial agent configuration to update
   */
  config?: PartialDeep<LobeAgentConfig>;
  /**
   * Partial metadata to update
   */
  meta?: Partial<MetaData>;
  /**
   * Plugin toggle operation - will be merged into config.plugins
   */
  togglePlugin?: {
    /**
     * Whether to enable the plugin. If not provided, toggles current state.
     */
    enabled?: boolean;
    /**
     * The plugin identifier to toggle
     */
    pluginId: string;
  };
}

export interface GetAvailableModelsParams {
  /**
   * Optional: filter by provider id
   */
  providerId?: string;
}

export interface UpdatePromptParams {
  /**
   * The new system prompt content (markdown format)
   */
  prompt: string;
  /**
   * Whether to use streaming mode for typewriter effect
   */
  streaming?: boolean;
}

// ============== State Types (for Render components) ==============

export interface UpdateConfigState {
  config?: {
    newValues: Record<string, unknown>;
    previousValues: Record<string, unknown>;
    updatedFields: string[];
  };
  meta?: {
    newValues: Partial<MetaData>;
    previousValues: Partial<MetaData>;
    updatedFields: string[];
  };
  success: boolean;
  togglePlugin?: {
    enabled: boolean;
    pluginId: string;
  };
}

export interface AvailableModel {
  abilities?: {
    files?: boolean;
    functionCall?: boolean;
    reasoning?: boolean;
    vision?: boolean;
  };
  description?: string;
  id: string;
  name: string;
}

export interface AvailableProvider {
  id: string;
  models: AvailableModel[];
  name: string;
}

export interface GetAvailableModelsState {
  providers: AvailableProvider[];
}

export interface UpdatePromptState {
  newPrompt: string;
  previousPrompt?: string;
  success: boolean;
}

// ============== SearchMarketTools Types ==============

export interface SearchMarketToolsParams {
  /**
   * Optional: filter by category (e.g., "developer", "productivity", "web-search")
   */
  category?: string;
  /**
   * Optional: number of results to return (default: 10, max: 20)
   */
  pageSize?: number;
  /**
   * Optional: search keywords to find specific tools
   */
  query?: string;
}

export interface MarketToolItem {
  author?: string;
  cloudEndPoint?: string;
  description?: string;
  haveCloudEndpoint?: boolean;
  icon?: string;
  identifier: string;
  installed?: boolean;
  name: string;
  tags?: string[];
}

export interface SearchMarketToolsState {
  query?: string;
  tools: MarketToolItem[];
  totalCount: number;
}

// Note: SearchOfficialTools types are removed because official tools are now
// automatically injected into the conversation context via AgentBuilderContextInjector

// ============== InstallPlugin Types ==============

export interface InstallPluginParams {
  /**
   * Plugin identifier to install
   */
  identifier: string;
  /**
   * Plugin source type: 'market' for MCP marketplace, 'official' for builtin/klavis/lobehubSkill tools
   */
  source: 'market' | 'official';
}

export interface InstallPluginState {
  /**
   * Whether the plugin requires human approval to continue installation
   * (e.g., Klavis tools need OAuth connection)
   */
  awaitingApproval?: boolean;
  /**
   * Error message if installation failed
   */
  error?: string;
  /**
   * Whether the plugin is installed
   */
  installed: boolean;
  /**
   * Whether the plugin is a Klavis tool that needs OAuth connection
   */
  isKlavis?: boolean;
  /**
   * Whether the plugin is a LobehubSkill provider that needs OAuth connection
   */
  isLobehubSkill?: boolean;
  /**
   * Klavis OAuth URL if authorization is needed
   */
  oauthUrl?: string;
  /**
   * Plugin identifier
   */
  pluginId: string;
  /**
   * Plugin display name
   */
  pluginName?: string;
  /**
   * Klavis server name (for Klavis tools)
   */
  serverName?: string;
  /**
   * Server status (for Klavis tools and LobehubSkill providers)
   */
  serverStatus?: 'connected' | 'pending_auth' | 'error' | 'not_connected';
  /**
   * Whether the operation was successful
   */
  success: boolean;
}
