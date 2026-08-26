export type SearchResultType =
  | 'page'
  | 'pageContent'
  | 'agent'
  | 'topic'
  | 'chatGroup'
  | 'file'
  | 'folder'
  | 'memory'
  | 'message'
  | 'mcp'
  | 'plugin'
  | 'communityAgent'
  | 'knowledgeBase';

export interface BaseSearchResult {
  createdAt: Date;
  description?: string | null;
  id: string;
  /** Normalized display relevance where lower is better. */
  relevance: number;
  title: string;
  type: SearchResultType;
  updatedAt: Date;
}

export interface PageSearchResult extends BaseSearchResult {
  id: string;
  type: 'page';
}

export interface PageContentSearchResult extends BaseSearchResult {
  id: string;
  type: 'pageContent';
}

export interface AgentSearchResult extends BaseSearchResult {
  avatar: string | null;
  backgroundColor: string | null;
  slug: string | null;
  tags: string[];
  type: 'agent';
}

export interface ChatGroupSearchResult extends BaseSearchResult {
  avatar: string | null;
  backgroundColor: string | null;
  type: 'chatGroup';
}

export interface TopicSearchResult extends BaseSearchResult {
  agent: {
    avatar: string | null;
    backgroundColor: string | null;
    title: string | null;
  } | null;
  agentId: string | null;
  favorite: boolean | null;
  groupId: string | null;
  sessionId: string | null;
  type: 'topic';
}

export interface FileSearchResult extends BaseSearchResult {
  fileType: string;
  knowledgeBaseId: string | null;
  name: string;
  size: number;
  type: 'file';
  url: string | null;
}

export interface FolderSearchResult extends BaseSearchResult {
  knowledgeBaseId: string | null;
  slug: string | null;
  type: 'folder';
}

export interface MessageSearchResult extends BaseSearchResult {
  agentId: string | null;
  content: string;
  groupId: string | null;
  model: string | null;
  role: string;
  topicId: string | null;
  type: 'message';
}

export interface MemorySearchResult extends BaseSearchResult {
  memoryLayer: string | null;
  type: 'memory';
}

export interface MCPSearchResult extends BaseSearchResult {
  author: string;
  avatar?: string | null;
  category?: string | null;
  connectionType?: 'http' | 'stdio' | null;
  identifier: string;
  installCount?: number | null;
  isFeatured?: boolean | null;
  isValidated?: boolean | null;
  tags?: string[] | null;
  type: 'mcp';
}

export interface PluginSearchResult extends BaseSearchResult {
  author: string;
  avatar?: string | null;
  category?: string | null;
  identifier: string;
  tags?: string[] | null;
  type: 'plugin';
}

export interface KnowledgeBaseSearchResult extends BaseSearchResult {
  avatar: string | null;
  type: 'knowledgeBase';
}

/**
 * Hydrated BM25 hit for KB-scoped documents. `fileId` identifies a parsed-file
 * source; inline pages use `documentId` directly.
 */
export interface KnowledgeBaseDocumentHit {
  documentId: string;
  fileId?: string;
  knowledgeBaseId: string;
  relevance: number;
  snippet: string;
  title: string;
  updatedAt: Date;
}

export interface AssistantSearchResult extends BaseSearchResult {
  author: string;
  avatar?: string | null;
  homepage?: string | null;
  identifier: string;
  tags?: string[] | null;
  type: 'communityAgent';
}

export type DatabaseSearchResult =
  | PageSearchResult
  | PageContentSearchResult
  | AgentSearchResult
  | ChatGroupSearchResult
  | TopicSearchResult
  | FileSearchResult
  | FolderSearchResult
  | MessageSearchResult
  | MemorySearchResult
  | KnowledgeBaseSearchResult;

export type SearchResult =
  DatabaseSearchResult | MCPSearchResult | PluginSearchResult | AssistantSearchResult;

export interface SearchOptions {
  agentId?: string;
  contextType?: 'agent' | 'resource' | 'page';
  /** Caller-relative restricted KBs that must not be discoverable. */
  excludeKnowledgeBaseIds?: string[];
  limitPerType?: number;
  offset?: number;
  query: string;
  type?: SearchResultType;
}

/** Entities implemented by the current product search repository contract. */
export type SearchBackendEntity =
  | 'agents'
  | 'chatGroups'
  | 'documents'
  | 'files'
  | 'knowledgeBases'
  | 'memoryActivities'
  | 'memoryContexts'
  | 'memoryExperiences'
  | 'memoryIdentities'
  | 'memoryPreferences'
  | 'messages'
  | 'personaDocuments'
  | 'topics'
  | 'userMemories';

export interface SearchBackendScope {
  /** Visibility of the agent initiating a KB search, when applicable. */
  callerAgentVisibility?: 'private' | 'public' | null;
  userId: string;
  workspaceId?: string;
}

export interface SearchBackendFilters {
  agentId?: string;
  documentKind?: 'folder' | 'knowledgeBaseDocument' | 'page';
  excludeKnowledgeBaseIds?: string[];
  excludeVirtual?: boolean;
  knowledgeBaseIds?: string[];
  memoryCategories?: string[];
  memoryRelationships?: string[];
  memoryStatus?: string[];
  /** Hybrid search requires every tag; legacy list search preserves its any-tag contract. */
  memoryTagMatch?: 'all' | 'any';
  memoryTags?: string[];
  memoryTimeRange?: {
    end?: Date;
    field?: 'capturedAt' | 'createdAt' | 'endsAt' | 'episodicDate' | 'startsAt' | 'updatedAt';
    start?: Date;
  };
  memoryTypes?: string[];
  topicScope?: {
    agentId?: string | null;
    containerId?: string | null;
    groupId?: string | null;
  };
}

export interface SearchBackendPagination {
  /** Omitted for legacy/list paths whose public contract is currently unbounded. */
  limit?: number;
}

export interface SearchBackendQuery {
  /** Exact mapped fields for a candidate-only production path. */
  fields?: string[];
  text: string;
}

export interface SearchBackendRequest {
  entity: SearchBackendEntity;
  filters: SearchBackendFilters;
  mode?: 'candidates' | 'results';
  pagination: SearchBackendPagination;
  query: SearchBackendQuery;
  scope: SearchBackendScope;
}

/** Raw provider candidate before authorization hydration and product-specific post-ranking. */
export interface SearchBackendCandidate {
  id: string;
  /** Provider-native score where higher is better; legacy pg_search can emit null. */
  score: number | null;
}

export type SearchBackendItem = DatabaseSearchResult | KnowledgeBaseDocumentHit;

export interface SearchBackendResponse<TItem extends SearchBackendItem = SearchBackendItem> {
  /**
   * Provider-native retrieval pool. It can be larger than and ordered differently from `items`
   * when the product applies a secondary display ranking, such as topic/message recency.
   */
  candidates: SearchBackendCandidate[];
  /** Hydrated, authorization-checked product items in display order. */
  items: TItem[];
  /** Provider match count before PostgreSQL authorization hydration. */
  total?: number;
}

export interface SearchBackend {
  /** Stable provider key used by switching and measurements. */
  key: string;
  search: (request: SearchBackendRequest) => Promise<SearchBackendResponse>;
}

export interface SearchBackendMeasurementRequest {
  entity: SearchBackendEntity;
  filterKeys: (keyof SearchBackendFilters)[];
  limit: number;
  queryLength: number;
  scope: 'personal' | 'workspace';
}

interface SearchBackendMeasurementBase {
  durationMs: number;
  provider: string;
  /** Privacy-safe request shape that excludes identifiers and user-entered text. */
  request: SearchBackendMeasurementRequest;
}

export type SearchBackendMeasurement =
  | (SearchBackendMeasurementBase & {
      candidateCount: number;
      itemCount: number;
      status: 'success';
    })
  | (SearchBackendMeasurementBase & {
      errorType: string;
      status: 'error';
    });

export interface SearchRepoOptions {
  backend?: SearchBackend;
  /** Enables candidate-only paths for models that otherwise keep their existing pg_search query. */
  candidateSearchEnabled?: boolean;
  onMeasurement?: (measurement: SearchBackendMeasurement) => Promise<void> | void;
}

export type SearchCandidateRequest = Omit<SearchBackendRequest, 'mode' | 'scope'>;

export interface SearchCandidateResult {
  candidates: SearchBackendCandidate[];
  total: number;
}

export interface SearchCandidateSource {
  candidateSearchEnabled: boolean;
  searchCandidates: (request: SearchCandidateRequest) => Promise<SearchCandidateResult>;
}
