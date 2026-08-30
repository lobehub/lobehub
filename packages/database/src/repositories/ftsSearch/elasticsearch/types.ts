import type {
  FtsSearchAgentResult,
  FtsSearchBackendCandidate,
  FtsSearchBackendFilters,
  FtsSearchChatGroupResult,
  FtsSearchFileResult,
  FtsSearchFolderResult,
  FtsSearchKnowledgeBaseDocumentHit,
  FtsSearchKnowledgeBaseResult,
  FtsSearchMemoryResult,
  FtsSearchMessageResult,
  FtsSearchPageResult,
  FtsSearchTopicResult,
} from '../types';
import type { ElasticsearchFtsSearchEntity } from './query-fields';

export interface ElasticsearchFtsSearchInput {
  body: Record<string, unknown>;
  entity: ElasticsearchFtsSearchEntity;
  index: string;
  pagination: 'bounded' | 'unbounded';
}

export interface ElasticsearchFtsSearchResponse {
  hits: {
    hits: Array<{
      _id: string;
      _score: number | null;
      sort?: unknown[];
    }>;
    total?: number | { value: number };
  };
  took?: number;
}

/** Minimal transport contract so deployments own credentials and HTTP/client policy. */
export interface ElasticsearchFtsSearchClient {
  search: (input: ElasticsearchFtsSearchInput) => Promise<ElasticsearchFtsSearchResponse>;
}

export type ElasticsearchFtsSearchOperation = 'candidate_query' | 'pg_hydration';

/** Optional deployment-owned instrumentation that keeps the database package vendor-neutral. */
export interface ElasticsearchFtsSearchObserver {
  observe: <Result>(
    entity: ElasticsearchFtsSearchEntity,
    operation: ElasticsearchFtsSearchOperation,
    callback: () => Promise<Result>,
  ) => Promise<Result>;
}

export interface ElasticsearchFtsSearchBackendOptions {
  client: ElasticsearchFtsSearchClient;
  indexNamespace: string;
  observer?: ElasticsearchFtsSearchObserver;
}

export interface FtsSearchCandidateHit extends FtsSearchBackendCandidate {
  rank: number;
}

export interface ElasticsearchFtsSearchCandidateResult {
  exhausted: boolean;
  hits: FtsSearchCandidateHit[];
  nextFtsSearchAfter?: unknown[];
  total: number;
}

export interface ElasticsearchFtsSearchCandidateOptions {
  searchAfter?: unknown[];
  singlePage?: boolean;
}

export interface FtsSearchHydratedScore {
  relevance: number;
  score: number;
}

export type ElasticsearchFtsSearchResult =
  | FtsSearchAgentResult
  | FtsSearchChatGroupResult
  | FtsSearchFileResult
  | FtsSearchFolderResult
  | FtsSearchKnowledgeBaseDocumentHit
  | FtsSearchKnowledgeBaseResult
  | FtsSearchMemoryResult
  | FtsSearchMessageResult
  | FtsSearchPageResult
  | FtsSearchTopicResult;

export type ElasticsearchFtsSearchDocumentKind = NonNullable<
  FtsSearchBackendFilters['documentKind']
>;
export type ElasticsearchFtsSearchCandidateTarget =
  | { documentKind: ElasticsearchFtsSearchDocumentKind; entity: 'documents' }
  | { entity: Exclude<ElasticsearchFtsSearchEntity, 'documents'> };

export interface ElasticsearchFtsSearchCandidateContext {
  client: ElasticsearchFtsSearchClient;
  indexNamespace: string;
}
