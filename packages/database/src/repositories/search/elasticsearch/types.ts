import type {
  AgentSearchResult,
  ChatGroupSearchResult,
  FileSearchResult,
  FolderSearchResult,
  KnowledgeBaseDocumentHit,
  KnowledgeBaseSearchResult,
  MemorySearchResult,
  MessageSearchResult,
  PageSearchResult,
  SearchBackendCandidate,
  SearchBackendFilters,
  TopicSearchResult,
} from '../types';
import type { ElasticsearchSearchEntity } from './query-fields';

export interface ElasticsearchSearchInput {
  body: Record<string, unknown>;
  entity: ElasticsearchSearchEntity;
  index: string;
  pagination: 'bounded' | 'unbounded';
}

export interface ElasticsearchSearchResponse {
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
export interface ElasticsearchSearchClient {
  search: (input: ElasticsearchSearchInput) => Promise<ElasticsearchSearchResponse>;
}

export type ElasticsearchSearchOperation = 'candidate_query' | 'pg_hydration';

/** Optional deployment-owned instrumentation that keeps the database package vendor-neutral. */
export interface ElasticsearchSearchObserver {
  observe: <Result>(
    entity: ElasticsearchSearchEntity,
    operation: ElasticsearchSearchOperation,
    callback: () => Promise<Result>,
  ) => Promise<Result>;
}

export interface ElasticsearchSearchBackendOptions {
  client: ElasticsearchSearchClient;
  indexNamespace: string;
  observer?: ElasticsearchSearchObserver;
}

export interface CandidateHit extends SearchBackendCandidate {
  rank: number;
}

export interface CandidateSearchResult {
  exhausted: boolean;
  hits: CandidateHit[];
  nextSearchAfter?: unknown[];
  total: number;
}

export interface CandidateSearchOptions {
  searchAfter?: unknown[];
  singlePage?: boolean;
}

export interface HydratedScore {
  relevance: number;
  score: number;
}

export type ElasticsearchSearchResult =
  | AgentSearchResult
  | ChatGroupSearchResult
  | FileSearchResult
  | FolderSearchResult
  | KnowledgeBaseDocumentHit
  | KnowledgeBaseSearchResult
  | MemorySearchResult
  | MessageSearchResult
  | PageSearchResult
  | TopicSearchResult;

export type ElasticsearchDocumentKind = NonNullable<SearchBackendFilters['documentKind']>;
export type ElasticsearchCandidateTarget =
  | { documentKind: ElasticsearchDocumentKind; entity: 'documents' }
  | { entity: Exclude<ElasticsearchSearchEntity, 'documents'> };

export interface ElasticsearchCandidateSearchContext {
  client: ElasticsearchSearchClient;
  indexNamespace: string;
}
