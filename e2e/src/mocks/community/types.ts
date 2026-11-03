/**
 * Type definitions for Discover mock data.
 *
 * Keep these small and E2E-focused: they only include fields the Community UI
 * reads while rendering list and detail pages.
 */

export interface ListResponse<T> {
  currentPage: number;
  items: T[];
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

// ============================================
// Assistant Types
// ============================================

export interface DiscoverAssistantItem {
  author: string;
  avatar: string;
  backgroundColor?: string;
  category: string;
  config?: Record<string, unknown>;
  createdAt: string;
  description: string;
  examples?: Record<string, unknown>[];
  identifier: string;
  installCount?: number;
  knowledgeCount?: number;
  pluginCount?: number;
  related?: DiscoverAssistantItem[];
  summary?: string;
  tags?: string[];
  title: string;
  tokenUsage?: number;
  type?: 'agent' | 'agent-group';
  updatedAt?: string;
  userName?: string;
}

export type AssistantListResponse = ListResponse<DiscoverAssistantItem>;

// ============================================
// Model Types
// ============================================

export interface DiscoverModelItem {
  abilities: {
    functionCall?: boolean;
    reasoning?: boolean;
    vision?: boolean;
  };
  contextWindowTokens: number;
  description: string;
  displayName: string;
  id: string;
  identifier: string;
  providerCount: number;
  providers: string[];
  releasedAt?: string;
  type: string;
}

export type ModelListResponse = ListResponse<DiscoverModelItem>;

// ============================================
// Provider Types
// ============================================

export interface DiscoverProviderItem {
  description: string;
  identifier: string;
  modelCount: number;
  models: string[];
  name: string;
  url?: string;
}

export type ProviderListResponse = ListResponse<DiscoverProviderItem>;

// ============================================
// MCP Types
// ============================================

export interface DiscoverMcpItem {
  author?: string;
  capabilities: {
    prompts: boolean;
    resources: boolean;
    tools: boolean;
  };
  category: string;
  connectionType?: 'http' | 'stdio';
  createdAt: string;
  description: string;
  github?: {
    stars?: number;
    url: string;
  };
  icon?: string;
  identifier: string;
  installationMethods?: string;
  installCount?: number;
  isClaimed?: boolean;
  isFeatured?: boolean;
  isOfficial?: boolean;
  isValidated?: boolean;
  manifestUrl: string;
  name: string;
  promptsCount?: number;
  resourcesCount?: number;
  toolsCount?: number;
  updatedAt: string;
}

export interface McpListResponse extends ListResponse<DiscoverMcpItem> {
  categories: string[];
}
