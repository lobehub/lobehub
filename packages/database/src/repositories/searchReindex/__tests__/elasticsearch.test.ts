import { afterEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_INDEX_ANALYSIS, SEARCH_INDEX_DEFINITIONS } from '../../searchDocument';
import { SearchReindexHttpClient } from '../elasticsearch';
import type { SearchReindexIndexBody } from '../service';

const response = (body: unknown, status = 200) =>
  new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const reindexMeta = { reindex_run_id: '00000000-0000-4000-8000-000000000001', schema_version: 1 };
const agentsIndexBody: SearchReindexIndexBody = {
  mappings: { ...SEARCH_INDEX_DEFINITIONS.agents.mappings, _meta: reindexMeta },
  settings: { analysis: SEARCH_INDEX_ANALYSIS },
};
const existingAgentsMapping = {
  'lobehub-messages-v1': {
    mappings: {
      _meta: reindexMeta,
      ...SEARCH_INDEX_DEFINITIONS.agents.mappings,
    },
  },
};
afterEach(() => vi.unstubAllGlobals());

describe('SearchReindexHttpClient', () => {
  it('rejects remote HTTP endpoints before exposing the API key', () => {
    expect(
      () =>
        new SearchReindexHttpClient({
          apiKey: 'secret-key',
          url: 'http://search.example.com',
        }),
    ).toThrow('must use HTTPS unless it targets loopback');
  });

  it('allows loopback HTTP endpoints for local development', () => {
    expect(
      () =>
        new SearchReindexHttpClient({
          apiKey: 'secret-key',
          url: 'http://localhost:9200',
        }),
    ).not.toThrow();
  });

  it('creates a missing index without exposing credentials in the URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined, 404))
      .mockResolvedValueOnce(response({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await client.ensureIndex('lobehub-messages-v1', agentsIndexBody);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://search.example.com/lobehub-messages-v1',
    );
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('secret-key');
  });

  it('refuses to recreate a missing index that the checkpoint already completed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(undefined, 404));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.ensureIndex('lobehub-messages-v1', agentsIndexBody, { createIfMissing: false }),
    ).rejects.toThrow('Completed Elasticsearch index lobehub-messages-v1 is missing');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('validates ICU analysis settings on an existing index', async () => {
    const incompatibleSettings = {
      'lobehub-messages-v1': {
        settings: {
          index: {
            analysis: {
              ...SEARCH_INDEX_ANALYSIS,
              analyzer: {
                ...SEARCH_INDEX_ANALYSIS.analyzer,
                lobehub_icu: {
                  filter: ['icu_folding'],
                  tokenizer: 'standard',
                  type: 'custom',
                },
              },
            },
          },
        },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(response(existingAgentsMapping))
      .mockResolvedValueOnce(response(incompatibleSettings));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureIndex('lobehub-messages-v1', agentsIndexBody)).rejects.toThrow(
      'analysis settings are incompatible',
    );
  });

  it('accepts an existing index with the expected mapping and analysis settings', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(response(existingAgentsMapping))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            settings: { index: { analysis: SEARCH_INDEX_ANALYSIS } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.ensureIndex('lobehub-messages-v1', agentsIndexBody),
    ).resolves.toBeUndefined();
  });

  it('refuses to resume into an existing index with an incompatible mapping', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: {
              _meta: reindexMeta,
              dynamic: 'strict',
              properties: {
                ...SEARCH_INDEX_DEFINITIONS.agents.mappings.properties,
                id: { type: 'text' },
              },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureIndex('lobehub-messages-v1', agentsIndexBody)).rejects.toThrow(
      'mapping is incompatible for id',
    );
  });

  it('refuses to resume an index created by a different local reindex run', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: {
              _meta: { ...reindexMeta, reindex_run_id: '00000000-0000-4000-8000-000000000002' },
              dynamic: 'strict',
              properties: {},
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureIndex('lobehub-messages-v1', agentsIndexBody)).rejects.toThrow(
      'reindex run identity is incompatible',
    );
  });

  it('keeps an alias that already targets the expected writable index', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        'lobehub-messages-v1': {
          aliases: { 'lobehub-messages': { is_write_index: true } },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.ensureAlias('lobehub-messages', 'lobehub-messages-v1'),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses to overwrite an alias that targets another index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          'lobehub-messages-v2': {
            aliases: { 'lobehub-messages': { is_write_index: true } },
          },
        }),
      ),
    );
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureAlias('lobehub-messages', 'lobehub-messages-v1')).rejects.toThrow(
      'already points to a different index',
    );
  });
});
