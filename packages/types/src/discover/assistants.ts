import type { FewShots } from '../llm';
import type { MetaData } from '../meta';
import type { LobeAgentSettings } from '../session';

export enum AssistantCategory {
  Academic = 'academic',
  All = 'all',
  Career = 'career',
  CopyWriting = 'copywriting',
  Design = 'design',
  Discover = 'discover',
  Education = 'education',
  Emotions = 'emotions',
  Entertainment = 'entertainment',
  Games = 'games',
  General = 'general',
  Life = 'life',
  Marketing = 'marketing',
  Office = 'office',
  Programming = 'programming',
  Translation = 'translation',
}

export enum AssistantSorts {
  HaveSkills = 'haveSkills',
  MostUsage = 'mostUsage',
  Recommended = 'recommended',
  UpdatedAt = 'updatedAt',
}

export enum AssistantNavKey {
  Capabilities = 'capabilities',
  Overview = 'overview',
  Related = 'related',
  SystemRole = 'systemRole',
  Version = 'version',
}

export type AgentStatus = 'published' | 'unpublished' | 'archived' | 'deprecated';

export type AgentType = 'agent' | 'agent-group';

export interface DiscoverAssistantItem extends Omit<LobeAgentSettings, 'meta'>, MetaData {
  author: string;
  category?: AssistantCategory;
  createdAt: string;
  /**
   * Fork count - number of times this agent has been forked
   */
  forkCount?: number;
  /**
   * Forked from agent ID - ID of the source agent if this is a fork
   * null means this is an original agent
   */
  forkedFromAgentId?: number | null;
  homepage: string;
  identifier: string;
  installCount?: number;
  isValidated?: boolean;
  knowledgeCount: number;
  pluginCount: number;
  status?: AgentStatus;
  tokenUsage: number;
  type?: AgentType;
  updatedAt?: string;
  userName?: string;
}

export type AssistantMarketSource = 'legacy' | 'new';

export interface AssistantQueryParams {
  category?: string;
  haveSkills?: boolean;
  includeAgentGroup?: boolean;
  locale?: string;
  order?: 'asc' | 'desc';
  ownerId?: string;
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: AssistantSorts;
  source?: AssistantMarketSource;
}

export interface AssistantListResponse {
  currentPage: number;
  items: DiscoverAssistantItem[];
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface DiscoverAssistantDetail extends DiscoverAssistantItem {
  currentVersion?: string;
  editorData?: any;
  examples?: FewShots;
  isValidated?: boolean;
  related: DiscoverAssistantItem[];
  summary?: string;
  versions?: DiscoverAssistantVersion[];
}

export interface DiscoverAssistantVersion {
  createdAt?: string;
  isLatest?: boolean;
  isValidated?: boolean;
  status?: AgentStatus;
  version: string;
}
