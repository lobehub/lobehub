// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { describe, expect, it, vi } from 'vitest';

import type { FtsSearchAgentResult, FtsSearchBackend } from '@/database/repositories/ftsSearch';

import {
  createFtsSearchRepo,
  FTS_SEARCH_PROVIDERS,
  FtsSearchBackendUnavailableError,
  resolveFtsSearchProvider,
} from './index';

const db = {} as LobeChatDatabase;

const agentResult: FtsSearchAgentResult = {
  avatar: null,
  backgroundColor: null,
  createdAt: new Date('2026-08-26T00:00:00.000Z'),
  description: 'Candidate result',
  id: 'agent-1',
  relevance: 1,
  slug: null,
  tags: [],
  title: 'Candidate Agent',
  type: 'agent',
  updatedAt: new Date('2026-08-26T00:00:00.000Z'),
};

describe('full-text search provider selection', () => {
  it('selects pg_search from deployment configuration', () => {
    expect(
      resolveFtsSearchProvider({
        loadFtsSearchProvider: () => FTS_SEARCH_PROVIDERS.pgSearch,
      }),
    ).toBe(FTS_SEARCH_PROVIDERS.pgSearch);
  });

  it('selects Elasticsearch from deployment configuration', () => {
    expect(
      resolveFtsSearchProvider({
        loadFtsSearchProvider: () => FTS_SEARCH_PROVIDERS.elasticsearch,
      }),
    ).toBe(FTS_SEARCH_PROVIDERS.elasticsearch);
  });

  it('routes the stable repository facade through the selected backend', async () => {
    const search = vi.fn<FtsSearchBackend['search']>().mockResolvedValue({
      candidates: [{ id: agentResult.id, score: 9.5 }],
      items: [agentResult],
    });
    const createBackend = vi.fn(({ provider }): FtsSearchBackend => ({ key: provider, search }));
    const repo = await createFtsSearchRepo(
      { db, userId: 'allowed-user' },
      {
        createBackend,
        loadFtsSearchProvider: () => FTS_SEARCH_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'candidate', type: 'agent' })).resolves.toEqual([
      agentResult,
    ]);
    expect(createBackend).toHaveBeenCalledWith(
      expect.objectContaining({ provider: FTS_SEARCH_PROVIDERS.elasticsearch }),
    );
    expect(repo.ftsSearchCandidateEnabled).toBe(true);
  });

  it('constructs the Elasticsearch backend from deployment-owned configuration', async () => {
    const search = vi.fn().mockResolvedValue({ hits: { hits: [] } });
    const createElasticsearchClient = vi.fn(() => ({ search }));
    const config = {
      apiKey: 'test-api-key',
      indexNamespace: 'lobehub-dev',
      url: 'https://search.example.com',
    };
    const repo = await createFtsSearchRepo(
      { db, userId: 'allowed-user' },
      {
        createElasticsearchClient,
        loadElasticsearchConfig: () => config,
        loadFtsSearchProvider: () => FTS_SEARCH_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'candidate', type: 'agent' })).resolves.toEqual([]);
    expect(createElasticsearchClient).toHaveBeenCalledWith(config);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ index: 'lobehub-dev-agents' }));
  });

  it('routes unified memory search to Elasticsearch when configured', async () => {
    const elasticsearchSearch = vi.fn().mockResolvedValue({ hits: { hits: [] } });
    const pgSearch = vi.fn<FtsSearchBackend['search']>().mockResolvedValue({
      candidates: [],
      items: [],
    });
    const repo = await createFtsSearchRepo(
      { db, userId: 'allowed-user' },
      {
        createElasticsearchClient: () => ({ search: elasticsearchSearch }),
        createPgSearchBackend: () => ({ key: 'pg_search', search: pgSearch }),
        loadElasticsearchConfig: () => ({
          apiKey: 'test-api-key',
          indexNamespace: 'lobehub-dev',
          url: 'https://search.example.com',
        }),
        loadFtsSearchProvider: () => FTS_SEARCH_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'candidate' })).resolves.toEqual([]);
    expect(elasticsearchSearch).toHaveBeenCalledTimes(9);
    expect(pgSearch).not.toHaveBeenCalled();
  });

  it('does not fall back to pg_search when a migrated Elasticsearch request fails', async () => {
    const providerError = new Error('Elasticsearch backend unavailable');
    const pgSearch = vi.fn<FtsSearchBackend['search']>().mockResolvedValue({
      candidates: [],
      items: [],
    });
    const repo = await createFtsSearchRepo(
      { db, userId: 'allowed-user' },
      {
        createElasticsearchClient: () => ({
          search: vi.fn().mockRejectedValue(providerError),
        }),
        createPgSearchBackend: () => ({ key: 'pg_search', search: pgSearch }),
        loadElasticsearchConfig: () => ({
          apiKey: 'test-api-key',
          indexNamespace: 'lobehub-dev',
          url: 'https://search.example.com',
        }),
        loadFtsSearchProvider: () => FTS_SEARCH_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'failure', type: 'agent' })).rejects.toBe(providerError);
    expect(pgSearch).not.toHaveBeenCalled();
  });

  it('fails explicitly when the selected provider is not configured', async () => {
    await expect(
      createFtsSearchRepo(
        { db, userId: 'user-1' },
        {
          loadElasticsearchConfig: () => undefined,
          loadFtsSearchProvider: () => FTS_SEARCH_PROVIDERS.elasticsearch,
        },
      ),
    ).rejects.toEqual(new FtsSearchBackendUnavailableError(FTS_SEARCH_PROVIDERS.elasticsearch));
  });

  it('surfaces Elasticsearch failures without retrying pg_search', async () => {
    const providerError = new Error('Elasticsearch backend unavailable');
    const search = vi.fn<FtsSearchBackend['search']>().mockRejectedValue(providerError);
    const createBackend = vi.fn(({ provider }): FtsSearchBackend => ({ key: provider, search }));
    const repo = await createFtsSearchRepo(
      { db, userId: 'user-1' },
      {
        createBackend,
        loadFtsSearchProvider: () => FTS_SEARCH_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'failure', type: 'agent' })).rejects.toBe(providerError);
    expect(createBackend).toHaveBeenCalledTimes(1);
    expect(createBackend).toHaveBeenCalledWith(
      expect.objectContaining({ provider: FTS_SEARCH_PROVIDERS.elasticsearch }),
    );
  });
});
