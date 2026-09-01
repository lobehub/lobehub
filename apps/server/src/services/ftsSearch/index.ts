import type { LobeChatDatabase } from '@lobechat/database';

import {
  ElasticsearchFtsSearchBackend,
  type ElasticsearchFtsSearchClient,
  type FtsSearchBackend,
  type FtsSearchBackendScope,
  FtsSearchRepo,
  type FtsSearchRepoOptions,
  isElasticsearchFtsSearchEntity,
  PgSearchFtsSearchBackend,
} from '@/database/repositories/ftsSearch';
import { ftsSearchEnv } from '@/envs/ftsSearch';

import { ElasticsearchFtsSearchHttpClient } from './elasticsearch';
import {
  createElasticsearchFtsSearchObserver,
  withFtsSearchBackendObservability,
} from './observability';

export interface CreateFtsSearchRepoInput {
  callerAgentVisibility?: 'private' | 'public' | null;
  db: LobeChatDatabase;
  options?: FtsSearchRepoOptions;
  userId: string;
  workspaceId?: string;
}

export const FTS_SEARCH_PROVIDERS = {
  elasticsearch: 'elasticsearch',
  pgSearch: 'pg_search',
} as const;

/** Deployment-selected implementation identity that resolves to an executable search backend. */
export type FtsSearchProvider = (typeof FTS_SEARCH_PROVIDERS)[keyof typeof FTS_SEARCH_PROVIDERS];

interface FtsSearchBackendFactoryContext {
  db: CreateFtsSearchRepoInput['db'];
  provider: FtsSearchProvider;
  scope: FtsSearchBackendScope;
}

interface FtsSearchBackendFactoryDependencies {
  createBackend?: (context: FtsSearchBackendFactoryContext) => FtsSearchBackend | undefined;
  createElasticsearchClient?: (
    config: ElasticsearchFtsSearchConfig,
  ) => ElasticsearchFtsSearchClient;
  createPgSearchBackend?: (context: FtsSearchBackendFactoryContext) => FtsSearchBackend;
  loadElasticsearchConfig?: () => ElasticsearchFtsSearchConfig | undefined;
  loadFtsSearchProvider?: () => FtsSearchProvider;
}

export interface ElasticsearchFtsSearchConfig {
  apiKey: string;
  indexNamespace: string;
  url: string;
}

export class FtsSearchBackendUnavailableError extends Error {
  readonly provider: FtsSearchProvider;

  constructor(provider: FtsSearchProvider) {
    super(`Full-text search backend provider is not configured: ${provider}`);
    this.name = 'FtsSearchBackendUnavailableError';
    this.provider = provider;
  }
}

export const loadElasticsearchFtsSearchConfig = (): ElasticsearchFtsSearchConfig | undefined => {
  const indexNamespace =
    ftsSearchEnv.ES_INDEX_NAMESPACE ??
    (process.env.NODE_ENV === 'development' ? 'lobehub-dev' : undefined);
  if (!ftsSearchEnv.ES_API_KEY || !ftsSearchEnv.ES_URL || !indexNamespace) return;

  return {
    apiKey: ftsSearchEnv.ES_API_KEY,
    indexNamespace,
    url: ftsSearchEnv.ES_URL,
  };
};

const createFtsSearchBackendForProvider = (
  { db, provider, scope }: FtsSearchBackendFactoryContext,
  dependencies: FtsSearchBackendFactoryDependencies,
): FtsSearchBackend | undefined => {
  const createPgSearchBackend =
    dependencies.createPgSearchBackend ??
    ((context: FtsSearchBackendFactoryContext) =>
      new PgSearchFtsSearchBackend(context.db, context.scope));
  const pgSearchBackend = createPgSearchBackend({ db, provider, scope });

  if (provider === FTS_SEARCH_PROVIDERS.pgSearch) {
    return pgSearchBackend;
  }

  const config = (dependencies.loadElasticsearchConfig ?? loadElasticsearchFtsSearchConfig)();
  if (!config) return;

  const client = (
    dependencies.createElasticsearchClient ??
    ((input) => new ElasticsearchFtsSearchHttpClient(input))
  )(config);
  const elasticsearchBackend = new ElasticsearchFtsSearchBackend(db, {
    client,
    indexNamespace: config.indexNamespace,
    observer: createElasticsearchFtsSearchObserver(),
  });

  return {
    key: `${elasticsearchBackend.key}+${pgSearchBackend.key}`,
    /** Unmigrated entities stay on pg_search; Elasticsearch failures on migrated entities remain fatal. */
    search: (request) =>
      isElasticsearchFtsSearchEntity(request.entity)
        ? elasticsearchBackend.search(request)
        : pgSearchBackend.search(request),
  };
};

export const resolveFtsSearchProvider = (
  dependencies: FtsSearchBackendFactoryDependencies = {},
): FtsSearchProvider => dependencies.loadFtsSearchProvider?.() ?? ftsSearchEnv.FTS_SEARCH_PROVIDER;

/**
 * Resolve the deployment-configured provider before constructing the stable repository facade.
 * Missing Elasticsearch configuration and provider failures remain visible; this layer never
 * falls back to pg_search.
 */
export const createFtsSearchRepo = async (
  input: CreateFtsSearchRepoInput,
  dependencies: FtsSearchBackendFactoryDependencies = {},
) => {
  const scope: FtsSearchBackendScope = {
    callerAgentVisibility: input.callerAgentVisibility,
    userId: input.userId,
    workspaceId: input.workspaceId,
  };
  const provider = resolveFtsSearchProvider(dependencies);
  const context = {
    db: input.db,
    provider,
    scope,
  };
  const backend = dependencies.createBackend
    ? dependencies.createBackend(context)
    : createFtsSearchBackendForProvider(context, dependencies);

  if (!backend) throw new FtsSearchBackendUnavailableError(provider);

  const observedBackend = withFtsSearchBackendObservability(backend, (request) =>
    provider === FTS_SEARCH_PROVIDERS.elasticsearch &&
    !isElasticsearchFtsSearchEntity(request.entity)
      ? FTS_SEARCH_PROVIDERS.pgSearch
      : provider,
  );

  return new FtsSearchRepo(input.db, input.userId, input.workspaceId, input.callerAgentVisibility, {
    ...input.options,
    backend: observedBackend,
    ftsSearchCandidateEnabled: provider === FTS_SEARCH_PROVIDERS.elasticsearch,
  });
};
