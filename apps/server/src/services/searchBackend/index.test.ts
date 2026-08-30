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
  it('keeps pg_search as the default provider', async () => {
    await expect(
      resolveSearchBackendProvider('user-1', {
        loadFeatureFlags: async () => ({ search_backend: false }),
      }),
    ).resolves.toBe(SEARCH_BACKEND_PROVIDERS.default);
  });

  it('selects the candidate for a globally enabled environment', async () => {
    await expect(
      resolveSearchBackendProvider('user-1', {
        loadFeatureFlags: async () => ({ search_backend: true }),
      }),
    ).resolves.toBe(SEARCH_BACKEND_PROVIDERS.candidate);
  });

  it('limits the candidate provider to allowlisted actors', async () => {
    const loadFeatureFlags = async () => ({ search_backend: ['allowed-user'] });

    await expect(resolveSearchBackendProvider('allowed-user', { loadFeatureFlags })).resolves.toBe(
      SEARCH_BACKEND_PROVIDERS.candidate,
    );
    await expect(resolveSearchBackendProvider('other-user', { loadFeatureFlags })).resolves.toBe(
      SEARCH_BACKEND_PROVIDERS.default,
    );
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
        loadFeatureFlags: async () => ({ search_backend: ['allowed-user'] }),
      },
    );

    await expect(repo.search({ query: 'candidate', type: 'agent' })).resolves.toEqual([
      agentResult,
    ]);
    expect(createBackend).toHaveBeenCalledWith(
      expect.objectContaining({ provider: SEARCH_BACKEND_PROVIDERS.candidate }),
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
        loadFeatureFlags: async () => ({ search_backend: true }),
      },
    );

    await expect(repo.search({ query: 'candidate', type: 'agent' })).resolves.toEqual([]);
    expect(createElasticsearchClient).toHaveBeenCalledWith(config);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ index: 'lobehub-dev-agents' }));
  });

  it('routes unified memory search to Elasticsearch when the candidate provider is selected', async () => {
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
        loadFeatureFlags: async () => ({ search_backend: true }),
      },
    );

    await expect(repo.search({ query: 'candidate' })).resolves.toEqual([]);
    expect(elasticsearchSearch).toHaveBeenCalledTimes(9);
    expect(postgresSearch).not.toHaveBeenCalled();
  });

  it('does not fall back to pg_search when a migrated Elasticsearch request fails', async () => {
    const providerError = new Error('candidate backend unavailable');
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
        loadFeatureFlags: async () => ({ search_backend: true }),
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
          loadFeatureFlags: async () => ({ search_backend: true }),
        },
      ),
    ).rejects.toEqual(new SearchBackendUnavailableError(SEARCH_BACKEND_PROVIDERS.candidate));
  });

  it('surfaces candidate failures without retrying pg_search', async () => {
    const providerError = new Error('candidate backend unavailable');
    const search = vi.fn<SearchBackend['search']>().mockRejectedValue(providerError);
    const createBackend = vi.fn(({ provider }): SearchBackend => ({ key: provider, search }));
    const repo = await createSearchRepo(
      { db, userId: 'user-1' },
      {
        createBackend,
        loadFeatureFlags: async () => ({ search_backend: true }),
      },
    );

    await expect(repo.search({ query: 'failure', type: 'agent' })).rejects.toBe(providerError);
    expect(createBackend).toHaveBeenCalledTimes(1);
    expect(createBackend).toHaveBeenCalledWith(
      expect.objectContaining({ provider: SEARCH_BACKEND_PROVIDERS.candidate }),
    );
  });
});
