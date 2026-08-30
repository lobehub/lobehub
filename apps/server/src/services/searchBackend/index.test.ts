// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { describe, expect, it, vi } from 'vitest';

import type { AgentSearchResult, SearchBackend } from '@/database/repositories/search';

import {
  createSearchRepo,
  resolveSearchBackendProvider,
  SEARCH_BACKEND_PROVIDERS,
  SearchBackendUnavailableError,
} from './index';

const db = {} as LobeChatDatabase;

const agentResult: AgentSearchResult = {
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

describe('search backend provider selection', () => {
  it('selects pg_search from deployment configuration', () => {
    expect(
      resolveSearchBackendProvider({
        loadSearchBackendProvider: () => SEARCH_BACKEND_PROVIDERS.postgres,
      }),
    ).toBe(SEARCH_BACKEND_PROVIDERS.postgres);
  });

  it('selects Elasticsearch from deployment configuration', () => {
    expect(
      resolveSearchBackendProvider({
        loadSearchBackendProvider: () => SEARCH_BACKEND_PROVIDERS.elasticsearch,
      }),
    ).toBe(SEARCH_BACKEND_PROVIDERS.elasticsearch);
  });

  it('routes the stable repository facade through the selected backend', async () => {
    const search = vi.fn<SearchBackend['search']>().mockResolvedValue({
      candidates: [{ id: agentResult.id, score: 9.5 }],
      items: [agentResult],
    });
    const createBackend = vi.fn(({ provider }): SearchBackend => ({ key: provider, search }));
    const repo = await createSearchRepo(
      { db, userId: 'allowed-user' },
      {
        createBackend,
        loadSearchBackendProvider: () => SEARCH_BACKEND_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'candidate', type: 'agent' })).resolves.toEqual([
      agentResult,
    ]);
    expect(createBackend).toHaveBeenCalledWith(
      expect.objectContaining({ provider: SEARCH_BACKEND_PROVIDERS.elasticsearch }),
    );
    expect(repo.candidateSearchEnabled).toBe(true);
  });

  it('constructs the Elasticsearch backend from deployment-owned configuration', async () => {
    const search = vi.fn().mockResolvedValue({ hits: { hits: [] } });
    const createElasticsearchClient = vi.fn(() => ({ search }));
    const config = {
      apiKey: 'test-api-key',
      indexNamespace: 'lobehub-dev',
      url: 'https://search.example.com',
    };
    const repo = await createSearchRepo(
      { db, userId: 'allowed-user' },
      {
        createElasticsearchClient,
        loadElasticsearchConfig: () => config,
        loadSearchBackendProvider: () => SEARCH_BACKEND_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'candidate', type: 'agent' })).resolves.toEqual([]);
    expect(createElasticsearchClient).toHaveBeenCalledWith(config);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ index: 'lobehub-dev-agents' }));
  });

  it('routes unified memory search to Elasticsearch when configured', async () => {
    const elasticsearchSearch = vi.fn().mockResolvedValue({ hits: { hits: [] } });
    const postgresSearch = vi.fn<SearchBackend['search']>().mockResolvedValue({
      candidates: [],
      items: [],
    });
    const repo = await createSearchRepo(
      { db, userId: 'allowed-user' },
      {
        createElasticsearchClient: () => ({ search: elasticsearchSearch }),
        createPostgresBackend: () => ({ key: 'pg_search', search: postgresSearch }),
        loadElasticsearchConfig: () => ({
          apiKey: 'test-api-key',
          indexNamespace: 'lobehub-dev',
          url: 'https://search.example.com',
        }),
        loadSearchBackendProvider: () => SEARCH_BACKEND_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'candidate' })).resolves.toEqual([]);
    expect(elasticsearchSearch).toHaveBeenCalledTimes(9);
    expect(postgresSearch).not.toHaveBeenCalled();
  });

  it('does not fall back to pg_search when a migrated Elasticsearch request fails', async () => {
    const providerError = new Error('Elasticsearch backend unavailable');
    const postgresSearch = vi.fn<SearchBackend['search']>().mockResolvedValue({
      candidates: [],
      items: [],
    });
    const repo = await createSearchRepo(
      { db, userId: 'allowed-user' },
      {
        createElasticsearchClient: () => ({
          search: vi.fn().mockRejectedValue(providerError),
        }),
        createPostgresBackend: () => ({ key: 'pg_search', search: postgresSearch }),
        loadElasticsearchConfig: () => ({
          apiKey: 'test-api-key',
          indexNamespace: 'lobehub-dev',
          url: 'https://search.example.com',
        }),
        loadSearchBackendProvider: () => SEARCH_BACKEND_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'failure', type: 'agent' })).rejects.toBe(providerError);
    expect(postgresSearch).not.toHaveBeenCalled();
  });

  it('fails explicitly when the selected provider is not configured', async () => {
    await expect(
      createSearchRepo(
        { db, userId: 'user-1' },
        {
          loadElasticsearchConfig: () => undefined,
          loadSearchBackendProvider: () => SEARCH_BACKEND_PROVIDERS.elasticsearch,
        },
      ),
    ).rejects.toEqual(new SearchBackendUnavailableError(SEARCH_BACKEND_PROVIDERS.elasticsearch));
  });

  it('surfaces Elasticsearch failures without retrying pg_search', async () => {
    const providerError = new Error('Elasticsearch backend unavailable');
    const search = vi.fn<SearchBackend['search']>().mockRejectedValue(providerError);
    const createBackend = vi.fn(({ provider }): SearchBackend => ({ key: provider, search }));
    const repo = await createSearchRepo(
      { db, userId: 'user-1' },
      {
        createBackend,
        loadSearchBackendProvider: () => SEARCH_BACKEND_PROVIDERS.elasticsearch,
      },
    );

    await expect(repo.search({ query: 'failure', type: 'agent' })).rejects.toBe(providerError);
    expect(createBackend).toHaveBeenCalledTimes(1);
    expect(createBackend).toHaveBeenCalledWith(
      expect.objectContaining({ provider: SEARCH_BACKEND_PROVIDERS.elasticsearch }),
    );
  });
});
