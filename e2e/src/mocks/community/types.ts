/**
 * Type definitions for Discover mock data
 * These mirror the actual types from the application
 */

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
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
  createdAt: string;
  description: string;
  identifier: string;
  installCount?: number;
  knowledgeCount?: number;
  pluginCount?: number;
  title: string;
  tokenUsage?: number;
  userName?: string;
}

export interface AssistantListResponse {
  items: DiscoverAssistantItem[];
  pagination: PaginationInfo;
}

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
  createdAt: string;
  description: string;
  displayName: string;
  id: string;
  providerId: string;
  providerName: string;
  type: string;
}

export interface ModelListResponse {
  items: DiscoverModelItem[];
  pagination: PaginationInfo;
}

// ============================================
// Provider Types
// ============================================

export interface DiscoverProviderItem {
  description: string;
  id: string;
  logo?: string;
  modelCount: number;
  name: string;
}

export interface ProviderListResponse {
  items: DiscoverProviderItem[];
  pagination: PaginationInfo;
}

// ============================================
// MCP Types
// ============================================

export interface DiscoverMcpItem {
  author: string;
  avatar: string;
  category: string;
  createdAt: string;
  description: string;
  identifier: string;
  installCount?: number;
  title: string;
}

export interface McpListResponse {
  items: DiscoverMcpItem[];
  pagination: PaginationInfo;
}
