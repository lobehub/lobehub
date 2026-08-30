// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertFtsSearchSyncAliases: vi.fn(),
  elasticsearchClient: vi.fn(),
  loadElasticsearchFtsSearchConfig: vi.fn(),
  searchDocumentBuilder: vi.fn(),
  ftsSearchEnv: { FTS_SEARCH_SYNC_ENABLED: undefined as 'false' | 'true' | undefined },
  assertCaptureInfrastructure: vi.fn(),
}));

vi.mock('@/envs/ftsSearch', () => ({ ftsSearchEnv: mocks.ftsSearchEnv }));

vi.mock('@/database/repositories/ftsSearchDocument', () => ({
  getFtsSearchIndexAlias: (namespace: string, entity: string) => `${namespace}-${entity}`,
  FTS_SEARCH_DOCUMENT_ENTITIES: ['agents', 'messages'],
  FtsSearchDocumentBuilder: mocks.searchDocumentBuilder,
}));

vi.mock('@/database/repositories/ftsSearchSyncOutbox/server', () => ({
  ftsSearchSyncOutboxRepository: {
    assertCaptureInfrastructure: mocks.assertCaptureInfrastructure,
    claim: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({ serverDB: { id: 'database' } }));

vi.mock('../ftsSearch', () => ({
  loadElasticsearchFtsSearchConfig: mocks.loadElasticsearchFtsSearchConfig,
}));

vi.mock('../ftsSearch/elasticsearch', () => ({
  ElasticsearchFtsSearchHttpClient: mocks.elasticsearchClient,
}));

const config = {
  apiKey: 'test-api-key',
  indexNamespace: 'lobehub-test',
  url: 'https://elasticsearch.example.com',
};

const loadRuntime = () => import('./runtime');

describe('full-text search sync runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.ftsSearchEnv.FTS_SEARCH_SYNC_ENABLED = undefined;
    mocks.loadElasticsearchFtsSearchConfig.mockReturnValue(config);
    mocks.elasticsearchClient.mockImplementation(() => ({
      assertFtsSearchSyncAliases: mocks.assertFtsSearchSyncAliases,
      bulk: vi.fn(),
    }));
    mocks.searchDocumentBuilder.mockImplementation(() => ({ buildByIds: vi.fn() }));
  });

  it('reports incremental sync as enabled only when the flag and configuration are present', async () => {
    const { isFtsSearchSyncEnabled } = await loadRuntime();

    expect(isFtsSearchSyncEnabled()).toBe(false);

    mocks.ftsSearchEnv.FTS_SEARCH_SYNC_ENABLED = 'true';
    expect(isFtsSearchSyncEnabled()).toBe(true);

    mocks.loadElasticsearchFtsSearchConfig.mockReturnValue(undefined);
    expect(isFtsSearchSyncEnabled()).toBe(false);
  });

  it('fails readiness checks when incremental sync is disabled', async () => {
    const { verifyFtsSearchSyncReadiness } = await loadRuntime();

    await expect(verifyFtsSearchSyncReadiness()).rejects.toThrow(
      'Elasticsearch full-text search sync is not enabled and configured',
    );
    expect(mocks.elasticsearchClient).not.toHaveBeenCalled();
  });

  it('verifies every search alias before reporting readiness', async () => {
    mocks.ftsSearchEnv.FTS_SEARCH_SYNC_ENABLED = 'true';
    const { verifyFtsSearchSyncReadiness } = await loadRuntime();

    await expect(verifyFtsSearchSyncReadiness()).resolves.toEqual({ ready: true });

    expect(mocks.elasticsearchClient).toHaveBeenCalledWith({
      ...config,
      requestTimeoutMs: 10_000,
    });
    expect(mocks.assertCaptureInfrastructure).toHaveBeenCalledOnce();
    expect(mocks.assertFtsSearchSyncAliases).toHaveBeenCalledWith([
      'lobehub-test-agents',
      'lobehub-test-messages',
    ]);
  });

  it('fails before checking aliases when PostgreSQL capture is not ready', async () => {
    mocks.ftsSearchEnv.FTS_SEARCH_SYNC_ENABLED = 'true';
    mocks.assertCaptureInfrastructure.mockRejectedValueOnce(new Error('capture is incomplete'));
    const { verifyFtsSearchSyncReadiness } = await loadRuntime();

    await expect(verifyFtsSearchSyncReadiness()).rejects.toThrow('capture is incomplete');
    expect(mocks.elasticsearchClient).not.toHaveBeenCalled();
  });

  it('constructs and caches the configured service instance', async () => {
    const { getFtsSearchSyncService } = await loadRuntime();

    const first = getFtsSearchSyncService();
    const second = getFtsSearchSyncService();

    expect(second).toBe(first);
    expect(mocks.searchDocumentBuilder).toHaveBeenCalledTimes(1);
    expect(mocks.elasticsearchClient).toHaveBeenCalledTimes(1);
    expect(mocks.elasticsearchClient).toHaveBeenCalledWith({
      ...config,
      requestTimeoutMs: 20_000,
    });
  });

  it('refuses to construct a service without Elasticsearch configuration', async () => {
    mocks.loadElasticsearchFtsSearchConfig.mockReturnValue(undefined);
    const { getFtsSearchSyncService } = await loadRuntime();

    expect(() => getFtsSearchSyncService()).toThrow(
      'Elasticsearch full-text search sync is not configured',
    );
    expect(mocks.searchDocumentBuilder).not.toHaveBeenCalled();
  });
});
