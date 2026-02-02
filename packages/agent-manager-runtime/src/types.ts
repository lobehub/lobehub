import type { LobeAgentConfig, MetaData } from '@lobechat/types';
import type { PartialDeep } from 'type-fest';

// ==================== Service Interfaces ====================

/**
 * Interface for agent service operations
 * Can be implemented by client-side or server-side services
 */
export interface IAgentService {
  createAgent: (params: { config: Record<string, unknown> }) => Promise<{
    agentId?: string;
    sessionId?: string;
  }>;
  queryAgents: (params: { keyword?: string; limit?: number }) => Promise<
    Array<{
      avatar?: string | null;
      backgroundColor?: string | null;
      description?: string | null;
      id: string;
      title?: string | null;
    }>
  >;
  removeAgent: (agentId: string) => Promise<unknown>;
}

/**
 * Interface for discover/marketplace service operations
 */
export interface IDiscoverService {
  getAssistantList: (params: { category?: string; pageSize?: number; q?: string }) => Promise<{
    items: Array<{
      avatar?: string;
      backgroundColor?: string;
      description?: string;
      identifier: string;
      title?: string;
    }>;
    totalCount: number;
  }>;
  getMcpList: (params: { category?: string; pageSize?: number; q?: string }) => Promise<{
    items: Array<{
      author?: string;
      cloudEndPoint?: string;
      description?: string;
      haveCloudEndpoint?: boolean;
      icon?: string;
      identifier: string;
      name: string;
      tags?: string[];
    }>;
    totalCount: number;
  }>;
}

/**
 * Required services for AgentManagerRuntime
 * Services must be injected for runtime-agnostic usage
 */
export interface AgentManagerRuntimeServices {
  /**
   * Agent service for CRUD operations
   */
  agentService: IAgentService;
  /**
   * Discover service for marketplace operations
   */
  discoverService: IDiscoverService;
}

// ==================== Agent CRUD Types ====================

export interface CreateAgentParams {
  avatar?: string;
  backgroundColor?: string;
  description?: string;
  model?: string;
  openingMessage?: string;
  openingQuestions?: string[];
  plugins?: string[];
  provider?: string;
  systemRole?: string;
  tags?: string[];
  title: string;
}

export interface CreateAgentState {
  agentId?: string;
  error?: string;
  sessionId?: string;
  success: boolean;
}

export interface UpdateAgentConfigParams {
  config?: PartialDeep<LobeAgentConfig>;
  meta?: Partial<MetaData>;
  togglePlugin?: {
    enabled?: boolean;
    pluginId: string;
  };
}

export interface UpdateAgentConfigState {
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

export interface DeleteAgentState {
  agentId: string;
  success: boolean;
}

// ==================== Search Types ====================

export type SearchAgentSource = 'user' | 'market' | 'all';

export interface SearchAgentParams {
  category?: string;
  keyword?: string;
  limit?: number;
  source?: SearchAgentSource;
}

export interface AgentSearchItem {
  avatar?: string;
  backgroundColor?: string;
  description?: string;
  id: string;
  isMarket?: boolean;
  title?: string;
}

export interface SearchAgentState {
  agents: AgentSearchItem[];
  keyword?: string;
  source: SearchAgentSource;
  totalCount: number;
}

// ==================== Models Types ====================

export interface GetAvailableModelsParams {
  providerId?: string;
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

// ==================== Prompt Types ====================

export interface UpdatePromptParams {
  prompt: string;
  streaming?: boolean;
}

export interface UpdatePromptState {
  newPrompt: string;
  previousPrompt?: string;
  success: boolean;
}

// ==================== Plugin/Tools Types ====================

export interface SearchMarketToolsParams {
  category?: string;
  pageSize?: number;
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

export interface InstallPluginParams {
  identifier: string;
  source: 'market' | 'official';
}

export interface InstallPluginState {
  awaitingApproval?: boolean;
  error?: string;
  installed: boolean;
  isKlavis?: boolean;
  isLobehubSkill?: boolean;
  oauthUrl?: string;
  pluginId: string;
  pluginName?: string;
  serverName?: string;
  serverStatus?: 'connected' | 'pending_auth' | 'error' | 'not_connected';
  success: boolean;
}
