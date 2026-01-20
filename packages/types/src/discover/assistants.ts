import { FewShots } from '../llm';
import { MetaData } from '../meta';
import { LobeAgentSettings } from '../session';

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
  CreatedAt = 'createdAt',
  Identifier = 'identifier',
  KnowledgeCount = 'knowledgeCount',
  MyOwn = 'myown',
  PluginCount = 'pluginCount',
  Recommended = 'recommended',
  Title = 'title',
  TokenUsage = 'tokenUsage',
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
  homepage: string;
  identifier: string;
  installCount?: number;
  knowledgeCount: number;
  pluginCount: number;
  status?: AgentStatus;
  tokenUsage: number;
  type?: AgentType;
  userName?: string;
}

export type AssistantMarketSource = 'legacy' | 'new';

export interface AssistantQueryParams {
  category?: string;
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
