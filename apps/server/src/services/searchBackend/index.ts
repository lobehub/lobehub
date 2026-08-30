import type { LobeChatDatabase } from '@lobechat/database';

import {
  ElasticsearchSearchBackend,
  type ElasticsearchSearchClient,
  isElasticsearchSearchEntity,
  PostgresSearchBackend,
  type SearchBackend,
  type SearchBackendScope,
  SearchRepo,
  type SearchRepoOptions,
} from '@/database/repositories/search';
import { searchEnv } from '@/envs/search';

import { ElasticsearchHttpClient } from './elasticsearch';
import { createElasticsearchSearchObserver, withSearchBackendObservability } from './observability';

export interface CreateSearchRepoInput {
  callerAgentVisibility?: 'private' | 'public' | null;
  db: LobeChatDatabase;
  options?: SearchRepoOptions;
  userId: string;
  workspaceId?: string;
}

export const SEARCH_BACKEND_PROVIDERS = {
  elasticsearch: 'elasticsearch',
  postgres: 'pg_search',
} as const;

export type SearchBackendProvider =
  (typeof SEARCH_BACKEND_PROVIDERS)[keyof typeof SEARCH_BACKEND_PROVIDERS];

interface SearchBackendFactoryContext {
  db: CreateSearchRepoInput['db'];
  provider: SearchBackendProvider;
  scope: SearchBackendScope;
}

interface SearchBackendFactoryDependencies {
  createBackend?: (context: SearchBackendFactoryContext) => SearchBackend | undefined;
  createElasticsearchClient?: (config: SearchElasticsearchConfig) => ElasticsearchSearchClient;
  createPostgresBackend?: (context: SearchBackendFactoryContext) => SearchBackend;
  loadElasticsearchConfig?: () => SearchElasticsearchConfig | undefined;
  loadSearchBackendProvider?: () => SearchBackendProvider;
}

export interface SearchElasticsearchConfig {
  apiKey: string;
  indexNamespace: string;
  url: string;
}

export class SearchBackendUnavailableError extends Error {
  readonly provider: SearchBackendProvider;

  constructor(provider: SearchBackendProvider) {
    super(`Search backend provider is not configured: ${provider}`);
    this.name = 'SearchBackendUnavailableError';
    this.provider = provider;
  }
}

export const loadSearchElasticsearchConfig = (): SearchElasticsearchConfig | undefined => {
  const indexNamespace =
    searchEnv.ES_INDEX_NAMESPACE ??
    (process.env.NODE_ENV === 'development' ? 'lobehub-dev' : undefined);
  if (!searchEnv.ES_API_KEY || !searchEnv.ES_URL || !indexNamespace) return;

  return {
    apiKey: searchEnv.ES_API_KEY,
    indexNamespace,
    url: searchEnv.ES_URL,
  };
};

const createBackendForProvider = (
  { db, provider, scope }: SearchBackendFactoryContext,
  dependencies: SearchBackendFactoryDependencies,
): SearchBackend | undefined => {
  const createPostgresBackend =
    dependencies.createPostgresBackend ??
    ((context: SearchBackendFactoryContext) =>
      new PostgresSearchBackend(context.db, context.scope));
  const postgresBackend = createPostgresBackend({ db, provider, scope });

  if (provider === SEARCH_BACKEND_PROVIDERS.postgres) {
    return postgresBackend;
  }

  const config = (dependencies.loadElasticsearchConfig ?? loadSearchElasticsearchConfig)();
  if (!config) return;

  const client = (
    dependencies.createElasticsearchClient ?? ((input) => new ElasticsearchHttpClient(input))
  )(config);
  const elasticsearchBackend = new ElasticsearchSearchBackend(db, {
    client,
    indexNamespace: config.indexNamespace,
    observer: createElasticsearchSearchObserver(),
  });

  return {
    key: `${elasticsearchBackend.key}+${postgresBackend.key}`,
    /** Unmigrated entities stay on pg_search; Elasticsearch failures on migrated entities remain fatal. */
    search: (request) =>
      isElasticsearchSearchEntity(request.entity)
        ? elasticsearchBackend.search(request)
        : postgresBackend.search(request),
  };
};

export const resolveSearchBackendProvider = (
  dependencies: SearchBackendFactoryDependencies = {},
): SearchBackendProvider => dependencies.loadSearchBackendProvider?.() ?? searchEnv.SEARCH_BACKEND;

/**
 * Resolve the deployment-configured provider before constructing the stable repository facade.
 * Missing Elasticsearch configuration and provider failures remain visible; this layer never
 * falls back to pg_search.
 */
export const createSearchRepo = async (
  input: CreateSearchRepoInput,
  dependencies: SearchBackendFactoryDependencies = {},
) => {
  const scope: SearchBackendScope = {
    callerAgentVisibility: input.callerAgentVisibility,
    userId: input.userId,
    workspaceId: input.workspaceId,
  };
  const provider = resolveSearchBackendProvider(dependencies);
  const context = {
    db: input.db,
    provider,
    scope,
  };
  const backend = dependencies.createBackend
    ? dependencies.createBackend(context)
    : createBackendForProvider(context, dependencies);

  if (!backend) throw new SearchBackendUnavailableError(provider);

  const observedBackend = withSearchBackendObservability(backend, (request) =>
    provider === SEARCH_BACKEND_PROVIDERS.elasticsearch &&
    !isElasticsearchSearchEntity(request.entity)
      ? SEARCH_BACKEND_PROVIDERS.postgres
      : provider,
  );

  return new SearchRepo(input.db, input.userId, input.workspaceId, input.callerAgentVisibility, {
    ...input.options,
    backend: observedBackend,
    candidateSearchEnabled: provider === SEARCH_BACKEND_PROVIDERS.elasticsearch,
  });
};
