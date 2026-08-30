// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertSearchSyncAliases: vi.fn(),
  elasticsearchClient: vi.fn(),
  loadSearchElasticsearchConfig: vi.fn(),
  searchDocumentBuilder: vi.fn(),
  searchEnv: { ES_INCREMENTAL_SYNC_ENABLED: undefined as 'false' | 'true' | undefined },
  assertCaptureInfrastructure: vi.fn(),
}));

vi.mock('@/envs/search', () => ({ searchEnv: mocks.searchEnv }));

vi.mock('@/database/repositories/searchDocument', () => ({
  getSearchIndexAlias: (namespace: string, entity: string) => `${namespace}-${entity}`,
  SEARCH_DOCUMENT_ENTITIES: ['agents', 'messages'],
  SearchDocumentBuilder: mocks.searchDocumentBuilder,
}));

vi.mock('@/database/repositories/searchSyncOutbox/server', () => ({
  searchSyncOutboxRepository: {
    assertCaptureInfrastructure: mocks.assertCaptureInfrastructure,
    claim: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({ serverDB: { id: 'database' } }));

vi.mock('../searchBackend', () => ({
  loadSearchElasticsearchConfig: mocks.loadSearchElasticsearchConfig,
}));

vi.mock('../searchBackend/elasticsearch', () => ({
  ElasticsearchHttpClient: mocks.elasticsearchClient,
}));

const config = {
  apiKey: 'test-api-key',
  indexNamespace: 'lobehub-test',
  url: 'https://elasticsearch.example.com',
};

const loadRuntime = () => import('./runtime');

describe('search sync runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.searchEnv.ES_INCREMENTAL_SYNC_ENABLED = undefined;
    mocks.loadSearchElasticsearchConfig.mockReturnValue(config);
    mocks.elasticsearchClient.mockImplementation(() => ({
      assertSearchSyncAliases: mocks.assertSearchSyncAliases,
      bulk: vi.fn(),
    }));
    mocks.searchDocumentBuilder.mockImplementation(() => ({ buildByIds: vi.fn() }));
  });

  it('reports incremental sync as enabled only when the flag and configuration are present', async () => {
    const { isIncrementalSearchSyncEnabled } = await loadRuntime();

    expect(isIncrementalSearchSyncEnabled()).toBe(false);

    mocks.searchEnv.ES_INCREMENTAL_SYNC_ENABLED = 'true';
    expect(isIncrementalSearchSyncEnabled()).toBe(true);

    mocks.loadSearchElasticsearchConfig.mockReturnValue(undefined);
    expect(isIncrementalSearchSyncEnabled()).toBe(false);
  });

  it('fails readiness checks when incremental sync is disabled', async () => {
    const { verifyIncrementalSearchSyncReadiness } = await loadRuntime();

    await expect(verifyIncrementalSearchSyncReadiness()).rejects.toThrow(
      'Elasticsearch incremental sync is not enabled and configured',
    );
    expect(mocks.elasticsearchClient).not.toHaveBeenCalled();
  });

  it('verifies every search alias before reporting readiness', async () => {
    mocks.searchEnv.ES_INCREMENTAL_SYNC_ENABLED = 'true';
    const { verifyIncrementalSearchSyncReadiness } = await loadRuntime();

    await expect(verifyIncrementalSearchSyncReadiness()).resolves.toEqual({ ready: true });

    expect(mocks.elasticsearchClient).toHaveBeenCalledWith({
      ...config,
      requestTimeoutMs: 10_000,
    });
    expect(mocks.assertCaptureInfrastructure).toHaveBeenCalledOnce();
    expect(mocks.assertSearchSyncAliases).toHaveBeenCalledWith([
      'lobehub-test-agents',
      'lobehub-test-messages',
    ]);
  });

  it('fails before checking aliases when PostgreSQL capture is not ready', async () => {
    mocks.searchEnv.ES_INCREMENTAL_SYNC_ENABLED = 'true';
    mocks.assertCaptureInfrastructure.mockRejectedValueOnce(new Error('capture is incomplete'));
    const { verifyIncrementalSearchSyncReadiness } = await loadRuntime();

    await expect(verifyIncrementalSearchSyncReadiness()).rejects.toThrow('capture is incomplete');
    expect(mocks.elasticsearchClient).not.toHaveBeenCalled();
  });

  it('constructs and caches the configured service instance', async () => {
    const { getSearchSyncService } = await loadRuntime();

    const first = getSearchSyncService();
    const second = getSearchSyncService();

    expect(second).toBe(first);
    expect(mocks.searchDocumentBuilder).toHaveBeenCalledTimes(1);
    expect(mocks.elasticsearchClient).toHaveBeenCalledTimes(1);
    expect(mocks.elasticsearchClient).toHaveBeenCalledWith({
      ...config,
      requestTimeoutMs: 20_000,
    });
  });

  it('refuses to construct a service without Elasticsearch configuration', async () => {
    mocks.loadSearchElasticsearchConfig.mockReturnValue(undefined);
    const { getSearchSyncService } = await loadRuntime();

    expect(() => getSearchSyncService()).toThrow(
      'Elasticsearch incremental sync is not configured',
    );
    expect(mocks.searchDocumentBuilder).not.toHaveBeenCalled();
  });
});
