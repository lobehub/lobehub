import type { LobeChatDatabase } from '@lobechat/database';
import { searchEnv } from '@lobechat/env/search';

import type { IFeatureFlags } from '@/config/featureFlags';
import { evaluateFeatureFlag } from '@/config/featureFlags';
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
import { getServerFeatureFlagsFromRuntimeConfig } from '@/server/featureFlags';

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
  candidate: 'elasticsearch',
  default: 'pg_search',
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
  loadFeatureFlags?: (userId: string) => Promise<Pick<IFeatureFlags, 'search_backend'>>;
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

const createDefaultBackend = (
  { db, provider, scope }: SearchBackendFactoryContext,
  dependencies: SearchBackendFactoryDependencies,
): SearchBackend | undefined => {
  const createPostgresBackend =
    dependencies.createPostgresBackend ??
    ((context: SearchBackendFactoryContext) =>
      new PostgresSearchBackend(context.db, context.scope));
  const postgresBackend = createPostgresBackend({ db, provider, scope });

  if (provider === SEARCH_BACKEND_PROVIDERS.default) {
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

export const resolveSearchBackendProvider = async (
  userId: string,
  dependencies: SearchBackendFactoryDependencies = {},
): Promise<SearchBackendProvider> => {
  const loadFeatureFlags = dependencies.loadFeatureFlags ?? getServerFeatureFlagsFromRuntimeConfig;
  const flags = await loadFeatureFlags(userId);

  return evaluateFeatureFlag(flags.search_backend, userId) === true
    ? SEARCH_BACKEND_PROVIDERS.candidate
    : SEARCH_BACKEND_PROVIDERS.default;
};

/**
 * Resolve the request-scoped provider before constructing the stable repository
 * facade. A missing or failing candidate is surfaced to the caller; this layer
 * never falls back to pg_search.
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
  const provider = await resolveSearchBackendProvider(input.userId, dependencies);
  const context = {
    db: input.db,
    provider,
    scope,
  };
  const backend = dependencies.createBackend
    ? dependencies.createBackend(context)
    : createDefaultBackend(context, dependencies);

  if (!backend) throw new SearchBackendUnavailableError(provider);

  const observedBackend = withSearchBackendObservability(backend, (request) =>
    provider === SEARCH_BACKEND_PROVIDERS.candidate && !isElasticsearchSearchEntity(request.entity)
      ? SEARCH_BACKEND_PROVIDERS.default
      : provider,
  );

  return new SearchRepo(input.db, input.userId, input.workspaceId, input.callerAgentVisibility, {
    ...input.options,
    backend: observedBackend,
    candidateSearchEnabled: provider === SEARCH_BACKEND_PROVIDERS.candidate,
  });
};
