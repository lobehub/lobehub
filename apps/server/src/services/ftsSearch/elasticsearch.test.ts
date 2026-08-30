// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ElasticsearchFtsSearchHttpClient } from './elasticsearch';

const mocks = vi.hoisted(() => ({
  recordSearchRequest: vi.fn(),
}));

vi.mock('./observability', () => ({
  recordElasticsearchFtsSearchRequest: mocks.recordSearchRequest,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ElasticsearchFtsSearchHttpClient', () => {
  it('rejects remote HTTP endpoints before exposing the API key', () => {
    expect(
      () =>
        new ElasticsearchFtsSearchHttpClient({
          apiKey: 'test-api-key',
          url: 'http://search.example.com',
        }),
    ).toThrow('must use HTTPS unless it targets loopback');
  });

  it('allows loopback HTTP endpoints for local development', () => {
    expect(
      () =>
        new ElasticsearchFtsSearchHttpClient({
          apiKey: 'test-api-key',
          url: 'http://localhost:9200',
        }),
    ).not.toThrow();
  });

  it('returns no write targets without making requests when no aliases are provided', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(client.getFtsSearchSyncWriteTargets([])).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends an authenticated search request and returns candidate hits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: {
            hits: [{ _id: 'agent-1', _score: 8.5, sort: [8.5, 'agent-1'] }],
            total: { value: 1 },
          },
          took: 12,
        }),
        { headers: { 'Content-Length': '120', 'Content-Type': 'application/json' }, status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      requestTimeoutMs: 5000,
      url: 'https://search.example.com',
    });

    await expect(
      client.search({
        body: { query: { match_all: {} }, size: 1 },
        entity: 'agents',
        index: 'lobehub-dev-agents',
        pagination: 'bounded',
      }),
    ).resolves.toEqual({
      hits: {
        hits: [{ _id: 'agent-1', _score: 8.5, sort: [8.5, 'agent-1'] }],
        total: { value: 1 },
      },
      took: 12,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://search.example.com/lobehub-dev-agents/_search'),
      expect.objectContaining({
        body: JSON.stringify({ query: { match_all: {} }, size: 1 }),
        headers: {
          'Authorization': 'ApiKey test-api-key',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
    expect(mocks.recordSearchRequest).toHaveBeenCalledWith({
      contentLength: 120,
      decodedBytes: expect.any(Number),
      durationMs: expect.any(Number),
      entity: 'agents',
      hits: 1,
      pagination: 'bounded',
      requestBytes: expect.any(Number),
      result: 'success',
      serverTookMs: 12,
    });
  });

  it('surfaces HTTP failures without copying response payloads into the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'sensitive backend detail' }), { status: 503 }),
        ),
    );
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.search({
        body: { query: { match_all: {} } },
        entity: 'agents',
        index: 'lobehub-dev-agents',
        pagination: 'bounded',
      }),
    ).rejects.toMatchObject({
      message: 'Elasticsearch search request failed (503)',
      status: 503,
    });
    expect(mocks.recordSearchRequest).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'agents', result: 'http_error' }),
    );
  });

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ hits: { hits: [{ _id: 123 }] } }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      ),
    );
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.search({
        body: { query: { match_all: {} } },
        entity: 'agents',
        index: 'lobehub-dev-agents',
        pagination: 'bounded',
      }),
    ).rejects.toThrow('Elasticsearch search response has an invalid shape');
    expect(mocks.recordSearchRequest).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'agents', result: 'parse_error' }),
    );
  });

  it('classifies fetch timeouts separately from other transport failures', async () => {
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });
    const input = {
      body: { query: { match_all: {} } },
      entity: 'agents' as const,
      index: 'lobehub-dev-agents',
      pagination: 'bounded' as const,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError')),
    );
    await expect(client.search(input)).rejects.toThrow('The operation timed out');
    expect(mocks.recordSearchRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ entity: 'agents', result: 'timeout' }),
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('connection closed')));
    await expect(client.search(input)).rejects.toThrow('connection closed');
    expect(mocks.recordSearchRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ entity: 'agents', result: 'other_error' }),
    );
  });

  it('sends bulk payloads to the alias-only endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: false, items: [{ index: { status: 201 } }] }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      requestTimeoutMs: 5000,
      url: 'https://search.example.com',
    });
    const body = '{"index":{}}\n{"id":"agent-1"}\n';

    await expect(client.bulk(body)).resolves.toEqual({
      errors: false,
      items: [{ index: { status: 201 } }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://search.example.com/_bulk?require_alias=true'),
      expect.objectContaining({
        body,
        headers: {
          'Authorization': 'ApiKey test-api-key',
          'Content-Type': 'application/x-ndjson',
        },
        method: 'POST',
      }),
    );
  });

  it('verifies writable aliases and their soft-delete mappings before synchronization', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          'lobehub-agents-v2': { aliases: { 'lobehub-agents': {} } },
          'lobehub-topics-v2': {
            aliases: { 'lobehub-topics': { is_write_index: true } },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          'lobehub-agents-v2': {
            mappings: {
              fts_search_sync_deleted: {
                full_name: 'fts_search_sync_deleted',
                mapping: { fts_search_sync_deleted: { type: 'boolean' } },
              },
            },
          },
          'lobehub-topics-v2': {
            mappings: {
              fts_search_sync_deleted: {
                full_name: 'fts_search_sync_deleted',
                mapping: { fts_search_sync_deleted: { type: 'boolean' } },
              },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.assertFtsSearchSyncAliases(['lobehub-agents', 'lobehub-topics']),
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://search.example.com/_alias/lobehub-agents,lobehub-topics',
      'https://search.example.com/lobehub-agents-v2,lobehub-topics-v2/_mapping/field/fts_search_sync_deleted',
    ]);
  });

  it('returns writable physical indices in stable alias order', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            'lobehub-agents-v2': { aliases: { 'lobehub-agents': {} } },
            'lobehub-topics-v2': { aliases: { 'lobehub-topics': {} } },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            'lobehub-agents-v2': {
              mappings: {
                fts_search_sync_deleted: {
                  mapping: { fts_search_sync_deleted: { type: 'boolean' } },
                },
              },
            },
            'lobehub-topics-v2': {
              mappings: {
                fts_search_sync_deleted: {
                  mapping: { fts_search_sync_deleted: { type: 'boolean' } },
                },
              },
            },
          }),
        ),
    );
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    const writeTargets = await client.getFtsSearchSyncWriteTargets([
      'lobehub-topics',
      'lobehub-agents',
    ]);

    expect(writeTargets).toEqual({
      'lobehub-agents': 'lobehub-agents-v2',
      'lobehub-topics': 'lobehub-topics-v2',
    });
    expect(Object.keys(writeTargets)).toEqual(['lobehub-agents', 'lobehub-topics']);
  });

  it('returns stable runtime identities for indices from one reindex run', async () => {
    const reindexRunId = '00000000-0000-4000-8000-000000000001';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          'lobehub-agents-v2': { aliases: { 'lobehub-agents': {} } },
          'lobehub-topics-v2': { aliases: { 'lobehub-topics': {} } },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          'lobehub-agents-v2': {
            mappings: {
              _meta: { reindex_run_id: reindexRunId, schema_version: 2 },
              dynamic: 'strict',
              properties: {
                id: { type: 'keyword' },
                fts_search_sync_deleted: { type: 'boolean' },
              },
            },
            settings: {
              index: {
                analysis: { analyzer: { lobehub_icu: { type: 'custom' } } },
                uuid: 'agents-index-uuid',
              },
            },
          },
          'lobehub-topics-v2': {
            mappings: {
              _meta: { reindex_run_id: reindexRunId, schema_version: 2 },
              dynamic: 'strict',
              properties: {
                id: { type: 'keyword' },
                fts_search_sync_deleted: { type: 'boolean' },
              },
            },
            settings: {
              index: {
                analysis: { analyzer: { lobehub_icu: { type: 'custom' } } },
                uuid: 'topics-index-uuid',
              },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    const identities = await client.getFtsSearchSyncIndexIdentities([
      'lobehub-topics',
      'lobehub-agents',
    ]);

    expect(identities).toEqual({
      'lobehub-agents': {
        indexUuid: 'agents-index-uuid',
        mappingSha256: expect.stringMatching(/^[\da-f]{64}$/),
        physicalIndex: 'lobehub-agents-v2',
        reindexRunId,
        schemaVersion: 2,
        settingsSha256: expect.stringMatching(/^[\da-f]{64}$/),
      },
      'lobehub-topics': {
        indexUuid: 'topics-index-uuid',
        mappingSha256: expect.stringMatching(/^[\da-f]{64}$/),
        physicalIndex: 'lobehub-topics-v2',
        reindexRunId,
        schemaVersion: 2,
        settingsSha256: expect.stringMatching(/^[\da-f]{64}$/),
      },
    });
    expect(Object.keys(identities)).toEqual(['lobehub-agents', 'lobehub-topics']);
    expect(identities['lobehub-agents'].mappingSha256).toBe(
      identities['lobehub-topics'].mappingSha256,
    );
    expect(identities['lobehub-agents'].settingsSha256).toBe(
      identities['lobehub-topics'].settingsSha256,
    );
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://search.example.com/_alias/lobehub-topics,lobehub-agents',
      'https://search.example.com/lobehub-agents-v2,lobehub-topics-v2?filter_path=*.mappings,*.settings.index.analysis,*.settings.index.uuid',
    ]);
  });

  it('rejects a runtime identity response with missing reindex metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ 'lobehub-agents-v2': { aliases: { 'lobehub-agents': {} } } }),
        )
        .mockResolvedValueOnce(
          Response.json({
            'lobehub-agents-v2': {
              mappings: {
                properties: { fts_search_sync_deleted: { type: 'boolean' } },
                sensitive_payload: 'must-not-leak',
              },
              settings: { index: { analysis: {}, uuid: 'agents-index-uuid' } },
            },
          }),
        ),
    );
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    const request = client.getFtsSearchSyncIndexIdentities(['lobehub-agents']);
    await expect(request).rejects.toThrow(
      'Elasticsearch full-text search sync index identity response has an invalid shape',
    );
    await expect(request).rejects.not.toThrow(/test-api-key|must-not-leak/);
  });

  it('rejects aliases that point to indices from different reindex runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            'lobehub-agents-v2': { aliases: { 'lobehub-agents': {} } },
            'lobehub-topics-v2': { aliases: { 'lobehub-topics': {} } },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            'lobehub-agents-v2': {
              mappings: {
                _meta: {
                  reindex_run_id: '00000000-0000-4000-8000-000000000001',
                  schema_version: 2,
                },
                properties: { fts_search_sync_deleted: { type: 'boolean' } },
              },
              settings: { index: { analysis: {}, uuid: 'agents-index-uuid' } },
            },
            'lobehub-topics-v2': {
              mappings: {
                _meta: {
                  reindex_run_id: '00000000-0000-4000-8000-000000000002',
                  schema_version: 2,
                },
                properties: { fts_search_sync_deleted: { type: 'boolean' } },
              },
              settings: { index: { analysis: {}, uuid: 'topics-index-uuid' } },
            },
          }),
        ),
    );
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.getFtsSearchSyncIndexIdentities(['lobehub-agents', 'lobehub-topics']),
    ).rejects.toThrow(
      'Elasticsearch full-text search sync aliases do not share one reindex run identity',
    );
  });

  it('selects the unique explicit write index for a multi-target alias', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            'lobehub-agents-v1': {
              aliases: { 'lobehub-agents': { is_write_index: false } },
            },
            'lobehub-agents-v2': {
              aliases: { 'lobehub-agents': { is_write_index: true } },
            },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            'lobehub-agents-v2': {
              mappings: {
                fts_search_sync_deleted: {
                  mapping: { fts_search_sync_deleted: { type: 'boolean' } },
                },
              },
            },
          }),
        ),
    );
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(client.getFtsSearchSyncWriteTargets(['lobehub-agents'])).resolves.toEqual({
      'lobehub-agents': 'lobehub-agents-v2',
    });
  });

  it('rejects a multi-target alias without an explicit write index', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        'lobehub-agents-v1': { aliases: { 'lobehub-agents': {} } },
        'lobehub-agents-v2': { aliases: { 'lobehub-agents': {} } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(client.getFtsSearchSyncWriteTargets(['lobehub-agents'])).rejects.toThrow(
      'Elasticsearch full-text search sync destination is not a writable alias: lobehub-agents',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an alias whose write index lacks the soft-delete mapping', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ 'lobehub-agents-v1': { aliases: { 'lobehub-agents': {} } } }),
        )
        .mockResolvedValueOnce(Response.json({ 'lobehub-agents-v1': { mappings: {} } })),
    );
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(client.getFtsSearchSyncWriteTargets(['lobehub-agents'])).rejects.toThrow(
      'Elasticsearch full-text search sync alias lacks a boolean fts_search_sync_deleted mapping: lobehub-agents',
    );
  });
});
