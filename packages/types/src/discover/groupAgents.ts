import type { MetaData } from '../meta';

/**
 * Group Agent Member - represents a member agent in a group
 */
export interface GroupAgentMember {
  avatar?: string;
  category?: string;
  config?: Record<string, any>;
  description: string;
  displayOrder?: number;
  enabled?: boolean;
  identifier: string;
  name: string;
  role: 'supervisor' | 'participant';
  url: string;
  version?: string;
}

/**
 * Group Agent Status
 */
export type GroupAgentStatus = 'published' | 'unpublished' | 'archived' | 'deprecated';

/**
 * Group Agent Visibility
 */
export type GroupAgentVisibility = 'public' | 'private' | 'internal';

/**
 * Group Agent Category
 */
export type GroupAgentCategory =
  | 'productivity'
  | 'entertainment'
  | 'education'
  | 'development'
  | 'business'
  | 'other';

/**
 * Group Agent Config - similar to LobeAgentConfig but for groups
 */
export interface GroupAgentConfig {
  /**
   * Opening message when starting a conversation with the group
   */
  openingMessage?: string;
  /**
   * Opening questions to guide users
   */
  openingQuestions?: string[];
  /**
   * System role/prompt for the group
   */
  systemRole?: string;
  /**
   * Additional configuration
   */
  [key: string]: any;
}

/**
 * Group Agent Item - basic info for list display
 */
export interface DiscoverGroupAgentItem extends MetaData {
  author?: string;
  avatar?: string;
  backgroundColor?: string;
  category?: GroupAgentCategory;
  config?: GroupAgentConfig;
  createdAt: string;
  description?: string;
  homepage?: string;
  identifier: string;
  installCount?: number;
  isFeatured?: boolean;
  isOfficial?: boolean;
  /**
   * Number of knowledge bases across all member agents
   */
  knowledgeCount?: number;
  /**
   * Number of member agents in the group
   */
  memberCount: number;
  /**
   * Number of plugins across all member agents
   */
  pluginCount?: number;
  status?: GroupAgentStatus;
  tags?: string[];
  title: string;
  /**
   * Estimated token usage for the group
   */
  tokenUsage?: number;
  updatedAt: string;
  userName?: string;
  version?: string;
  versionNumber?: number;
  visibility?: GroupAgentVisibility;
}

/**
 * Group Agent Version
 */
export interface DiscoverGroupAgentVersion {
  changelog?: string;
  createdAt?: string;
  isLatest?: boolean;
  isValidated?: boolean;
  status?: GroupAgentStatus;
  version: string;
  versionNumber: number;
}

/**
 * Group Agent Detail - complete info for detail page
 */
export interface DiscoverGroupAgentDetail extends DiscoverGroupAgentItem {
  /**
   * Current version string
   */
  currentVersion?: string;
  /**
   * Current version number
   */
  currentVersionNumber?: number;
  /**
   * Example conversations (if available from config)
   */
  examples?: any;
  /**
   * Member agents in the group
   */
  memberAgents: GroupAgentMember[];
  /**
   * Owner ID
   */
  ownerId?: string;
  /**
   * Related group agents
   */
  related?: DiscoverGroupAgentItem[];
  /**
   * Summary text (extracted from description or config)
   */
  summary?: string;
  /**
   * Version history
   */
  versions?: DiscoverGroupAgentVersion[];
}

/**
 * Group Agent List Response
 */
export interface GroupAgentListResponse {
  currentPage: number;
  items: DiscoverGroupAgentItem[];
  totalCount: number;
  totalPages: number;
}

/**
 * Group Agent Query Parameters
 */
export interface GroupAgentQueryParams {
  category?: string;
  locale?: string;
  order?: 'asc' | 'desc';
  ownerId?: string;
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'createdAt' | 'updatedAt' | 'name' | 'recommended';
}

/**
 * Group Agent Detail Query Parameters
 */
export interface GroupAgentDetailParams {
  identifier: string;
  locale?: string;
  version?: string;
}

/**
 * Group Agent Category Item
 */
export interface GroupAgentCategoryItem {
  category: GroupAgentCategory;
  count: number;
  name: string;
}
