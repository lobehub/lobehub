import type { LobeChatDatabase } from '@lobechat/database';

import {
  ElasticsearchFtsSearchBackend,
  type ElasticsearchFtsSearchClient,
  type FtsSearchBackend,
  type FtsSearchBackendScope,
  FtsSearchRepo,
  type FtsSearchRepoOptions,
  PgSearchFtsSearchBackend,
} from '@/database/repositories/ftsSearch';
import { ftsSearchEnv } from '@/envs/ftsSearch';

import { ElasticsearchFtsSearchHttpClient } from './elasticsearch';
import {
  createElasticsearchFtsSearchObserver,
  type FtsSearchUsage,
  withFtsSearchBackendObservability,
} from './observability';

export interface CreateFtsSearchRepoInput {
  callerAgentVisibility?: 'private' | 'public' | null;
  db: LobeChatDatabase;
  options?: FtsSearchRepoOptions;
  usage: FtsSearchUsage;
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
  usage: FtsSearchUsage;
}

interface FtsSearchBackendFactoryDependencies {
  createBackend?: (context: FtsSearchBackendFactoryContext) => FtsSearchBackend | undefined;
  createElasticsearchClient?: (
    config: ElasticsearchFtsSearchConfig,
    usage: FtsSearchUsage,
  ) => ElasticsearchFtsSearchClient;
  createPgSearchBackend?: (context: FtsSearchBackendFactoryContext) => FtsSearchBackend;
  loadElasticsearchConfig?: () => ElasticsearchFtsSearchConfig | undefined;
  loadFtsSearchProvider?: () => FtsSearchProvider;
}

export interface ElasticsearchFtsSearchConfig {
  /**
   * Explicit opt-in for plaintext HTTP / no API key on a private container network.
   * Optional so downstream callers that build a config literal keep the secure default (`false`).
   */
  allowInsecureHttp?: boolean;
  /** Required unless `allowInsecureHttp` is enabled; never sent over plaintext HTTP. */
  apiKey?: string;
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
  const allowInsecureHttp = ftsSearchEnv.ES_ALLOW_INSECURE_HTTP === 'true';
  /** The Elastic Cloud path keeps requiring an API key; only the explicit insecure mode may omit it. */
  if (!ftsSearchEnv.ES_URL || !indexNamespace) return;
  if (!ftsSearchEnv.ES_API_KEY && !allowInsecureHttp) return;

  return {
    allowInsecureHttp,
    apiKey: ftsSearchEnv.ES_API_KEY,
    indexNamespace,
    url: ftsSearchEnv.ES_URL,
  };
};

const createFtsSearchBackendForProvider = (
  { db, provider, scope, usage }: FtsSearchBackendFactoryContext,
  dependencies: FtsSearchBackendFactoryDependencies,
): FtsSearchBackend | undefined => {
  if (provider === FTS_SEARCH_PROVIDERS.pgSearch) {
    const createPgSearchBackend =
      dependencies.createPgSearchBackend ??
      ((context: FtsSearchBackendFactoryContext) =>
        new PgSearchFtsSearchBackend(context.db, context.scope));
    return createPgSearchBackend({ db, provider, scope, usage });
  }

  const config = (dependencies.loadElasticsearchConfig ?? loadElasticsearchFtsSearchConfig)();
  if (!config) return;

  const client = (
    dependencies.createElasticsearchClient ??
    ((input, inputUsage) => new ElasticsearchFtsSearchHttpClient({ ...input, usage: inputUsage }))
  )(config, usage);
  return new ElasticsearchFtsSearchBackend(db, {
    client,
    indexNamespace: config.indexNamespace,
    observer: createElasticsearchFtsSearchObserver(usage),
  });
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
    usage: input.usage,
  };
  const backend = dependencies.createBackend
    ? dependencies.createBackend(context)
    : createFtsSearchBackendForProvider(context, dependencies);

  if (!backend) throw new FtsSearchBackendUnavailableError(provider);

  const observedBackend = withFtsSearchBackendObservability(backend, () => provider, input.usage);

  return new FtsSearchRepo(input.db, input.userId, input.workspaceId, input.callerAgentVisibility, {
    ...input.options,
    backend: observedBackend,
    ftsSearchCandidateEnabled: provider === FTS_SEARCH_PROVIDERS.elasticsearch,
  });
};
