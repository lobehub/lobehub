export type FtsSearchResultType =
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

export interface FtsSearchBaseResult {
  createdAt: Date;
  description?: string | null;
  id: string;
  /** Normalized display relevance where lower is better. */
  relevance: number;
  title: string;
  type: FtsSearchResultType;
  updatedAt: Date;
}

export interface FtsSearchPageResult extends FtsSearchBaseResult {
  id: string;
  type: 'page';
}

export interface FtsSearchPageContentResult extends FtsSearchBaseResult {
  id: string;
  type: 'pageContent';
}

export interface FtsSearchAgentResult extends FtsSearchBaseResult {
  avatar: string | null;
  backgroundColor: string | null;
  slug: string | null;
  tags: string[];
  type: 'agent';
}

export interface FtsSearchChatGroupResult extends FtsSearchBaseResult {
  avatar: string | null;
  backgroundColor: string | null;
  type: 'chatGroup';
}

export interface FtsSearchTopicResult extends FtsSearchBaseResult {
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

export interface FtsSearchFileResult extends FtsSearchBaseResult {
  fileType: string;
  knowledgeBaseId: string | null;
  name: string;
  size: number;
  type: 'file';
  url: string | null;
}

export interface FtsSearchFolderResult extends FtsSearchBaseResult {
  knowledgeBaseId: string | null;
  slug: string | null;
  type: 'folder';
}

export interface FtsSearchMessageResult extends FtsSearchBaseResult {
  agentId: string | null;
  content: string;
  groupId: string | null;
  model: string | null;
  role: string;
  topicId: string | null;
  type: 'message';
}

export interface FtsSearchMemoryResult extends FtsSearchBaseResult {
  memoryLayer: string | null;
  type: 'memory';
}

export interface FtsSearchMCPResult extends FtsSearchBaseResult {
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

export interface FtsSearchPluginResult extends FtsSearchBaseResult {
  author: string;
  avatar?: string | null;
  category?: string | null;
  identifier: string;
  tags?: string[] | null;
  type: 'plugin';
}

export interface FtsSearchKnowledgeBaseResult extends FtsSearchBaseResult {
  avatar: string | null;
  type: 'knowledgeBase';
}

/**
 * Hydrated BM25 hit for KB-scoped documents. `fileId` identifies a parsed-file
 * source; inline pages use `documentId` directly.
 */
export interface FtsSearchKnowledgeBaseDocumentHit {
  documentId: string;
  fileId?: string;
  knowledgeBaseId: string;
  relevance: number;
  snippet: string;
  title: string;
  updatedAt: Date;
}

export interface FtsSearchAssistantResult extends FtsSearchBaseResult {
  author: string;
  avatar?: string | null;
  homepage?: string | null;
  identifier: string;
  tags?: string[] | null;
  type: 'communityAgent';
}

export type FtsSearchDatabaseResult =
  | FtsSearchPageResult
  | FtsSearchPageContentResult
  | FtsSearchAgentResult
  | FtsSearchChatGroupResult
  | FtsSearchTopicResult
  | FtsSearchFileResult
  | FtsSearchFolderResult
  | FtsSearchMessageResult
  | FtsSearchMemoryResult
  | FtsSearchKnowledgeBaseResult;

export type FtsSearchResult =
  FtsSearchDatabaseResult | FtsSearchMCPResult | FtsSearchPluginResult | FtsSearchAssistantResult;

export interface FtsSearchOptions {
  agentId?: string;
  contextType?: 'agent' | 'resource' | 'page';
  /** Caller-relative restricted KBs that must not be discoverable. */
  excludeKnowledgeBaseIds?: string[];
  limitPerType?: number;
  offset?: number;
  query: string;
  type?: FtsSearchResultType;
}

/** Entities implemented by the current product search repository contract. */
export const FTS_SEARCH_BACKEND_ENTITIES = [
  'agents',
  'chatGroups',
  'documents',
  'files',
  'knowledgeBases',
  'memoryActivities',
  'memoryContexts',
  'memoryExperiences',
  'memoryIdentities',
  'memoryPreferences',
  'messages',
  'personaDocuments',
  'topics',
  'userMemories',
] as const;

export type FtsSearchBackendEntity = (typeof FTS_SEARCH_BACKEND_ENTITIES)[number];

export interface FtsSearchBackendScope {
  /** Visibility of the agent initiating a KB search, when applicable. */
  callerAgentVisibility?: 'private' | 'public' | null;
  userId: string;
  workspaceId?: string;
}

export interface FtsSearchBackendFilters {
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

export interface FtsSearchBackendPagination {
  /** Omitted for legacy/list paths whose public contract is currently unbounded. */
  limit?: number;
}

export interface FtsSearchBackendQuery {
  /** Exact mapped fields for a candidate-only production path. */
  fields?: string[];
  text: string;
}

export interface FtsSearchBackendRequest {
  entity: FtsSearchBackendEntity;
  filters: FtsSearchBackendFilters;
  mode?: 'candidates' | 'results';
  pagination: FtsSearchBackendPagination;
  query: FtsSearchBackendQuery;
  scope: FtsSearchBackendScope;
}

/** Raw provider candidate before authorization hydration and product-specific post-ranking. */
export interface FtsSearchBackendCandidate {
  id: string;
  /** Provider-native score where higher is better; legacy pg_search can emit null. */
  score: number | null;
}

export type FtsSearchBackendItem = FtsSearchDatabaseResult | FtsSearchKnowledgeBaseDocumentHit;

export interface FtsSearchBackendResponse<
  TItem extends FtsSearchBackendItem = FtsSearchBackendItem,
> {
  /**
   * Provider-native retrieval pool. It can be larger than and ordered differently from `items`
   * when the product applies a secondary display ranking, such as topic/message recency.
   */
  candidates: FtsSearchBackendCandidate[];
  /** Hydrated, authorization-checked product items in display order. */
  items: TItem[];
  /** Provider match count before PostgreSQL authorization hydration. */
  total?: number;
}

/** Provider-neutral execution contract implemented by each full-text search adapter. */
export interface FtsSearchBackend {
  /** Stable backend identity used by repository-level measurements. */
  key: string;
  search: (request: FtsSearchBackendRequest) => Promise<FtsSearchBackendResponse>;
}

export interface FtsSearchBackendMeasurementRequest {
  entity: FtsSearchBackendEntity;
  filterKeys: (keyof FtsSearchBackendFilters)[];
  limit: number;
  queryLength: number;
  scope: 'personal' | 'workspace';
}

interface FtsSearchBackendMeasurementBase {
  durationMs: number;
  provider: string;
  /** Privacy-safe request shape that excludes identifiers and user-entered text. */
  request: FtsSearchBackendMeasurementRequest;
}

export type FtsSearchBackendMeasurement =
  | (FtsSearchBackendMeasurementBase & {
      candidateCount: number;
      itemCount: number;
      status: 'success';
    })
  | (FtsSearchBackendMeasurementBase & {
      errorType: string;
      status: 'error';
    });

export interface FtsSearchRepoOptions {
  backend?: FtsSearchBackend;
  /** Enables candidate-only paths for models that otherwise keep their existing pg_search query. */
  ftsSearchCandidateEnabled?: boolean;
  onMeasurement?: (measurement: FtsSearchBackendMeasurement) => Promise<void> | void;
}

export type FtsSearchCandidateRequest = Omit<FtsSearchBackendRequest, 'mode' | 'scope'>;

export interface FtsSearchCandidateResult {
  candidates: FtsSearchBackendCandidate[];
  total: number;
}

export interface FtsSearchCandidateSource {
  ftsSearchCandidateEnabled: boolean;
  ftsSearchCandidates: (request: FtsSearchCandidateRequest) => Promise<FtsSearchCandidateResult>;
}
