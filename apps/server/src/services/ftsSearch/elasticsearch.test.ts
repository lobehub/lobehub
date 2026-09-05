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
  vi.restoreAllMocks();
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

  it('rejects an API key over plaintext HTTP even when insecure HTTP is allowed', () => {
    expect(
      () =>
        new ElasticsearchFtsSearchHttpClient({
          allowInsecureHttp: true,
          apiKey: 'test-api-key',
          url: 'http://elasticsearch:9200',
        }),
    ).toThrow('must not be sent over plaintext HTTP');
  });

  it('requires an API key unless insecure private-network access is explicitly allowed', () => {
    expect(
      () => new ElasticsearchFtsSearchHttpClient({ url: 'https://search.example.com' }),
    ).toThrow('API key is required unless ES_ALLOW_INSECURE_HTTP=true');
  });

  it('sends unauthenticated requests to an explicitly insecure private-network endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hits: { hits: [] }, took: 1 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ElasticsearchFtsSearchHttpClient({
      allowInsecureHttp: true,
      url: 'http://elasticsearch:9200',
    });

    await client.search({
      body: { query: { match_all: {} } },
      entity: 'agents',
      executedQueryChars: 1,
      index: 'lobehub-agents',
      originalQueryChars: 1,
      pagination: 'bounded',
      queryFieldCount: 1,
      truncated: false,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe('http://elasticsearch:9200/lobehub-agents/_search');
    expect(Object.keys(init.headers)).not.toContain('Authorization');
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
        executedQueryChars: 0,
        index: 'lobehub-dev-agents',
        originalQueryChars: 0,
        pagination: 'bounded',
        queryFieldCount: 0,
        truncated: false,
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
      errorCode: 'none',
      executedQueryChars: 0,
      hits: 1,
      originalQueryChars: 0,
      pagination: 'bounded',
      queryFieldCount: 0,
      requestBytes: expect.any(Number),
      result: 'success',
      serverTookMs: 12,
      traceContext: expect.any(String),
      truncated: false,
      usage: 'unattributed',
    });
  });

  it('classifies nested clause-limit failures without copying response payloads into the error', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          caused_by: {
            reason: 'too many nested clauses: secret-query-fragment',
            type: 'too_many_clauses',
          },
          reason: 'all shards failed',
          root_cause: [{ type: 'query_shard_exception' }],
          type: 'search_phase_execution_exception',
        },
      }),
      { status: 400 },
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.search({
        body: { query: { match_all: {} } },
        entity: 'agents',
        executedQueryChars: 96,
        index: 'lobehub-dev-agents',
        originalQueryChars: 7000,
        pagination: 'bounded',
        queryFieldCount: 8,
        truncated: true,
      }),
    ).rejects.toMatchObject({
      errorCode: 'too_many_clauses',
      message: 'Elasticsearch search request failed (400, too_many_clauses)',
      status: 400,
    });
    expect(response.bodyUsed).toBe(true);
    expect(mocks.recordSearchRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'agents',
        errorCode: 'too_many_clauses',
        result: 'http_error',
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith('[fts-search] Elasticsearch request failed', {
      entity: 'agents',
      errorCode: 'too_many_clauses',
      executedQueryChars: 96,
      originalQueryChars: 7000,
      queryFieldCount: 8,
      requestBytes: expect.any(Number),
      status: 400,
      traceContext: expect.any(String),
      traceId: expect.any(String),
      truncated: true,
      usage: 'unattributed',
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-query-fragment');
  });

  it('classifies generic server failures without exposing the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'sensitive backend detail' }), { status: 503 }),
        ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new ElasticsearchFtsSearchHttpClient({
      apiKey: 'test-api-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.search({
        body: { query: { match_all: {} } },
        entity: 'agents',
        executedQueryChars: 0,
        index: 'lobehub-dev-agents',
        originalQueryChars: 0,
        pagination: 'bounded',
        queryFieldCount: 0,
        truncated: false,
      }),
    ).rejects.toMatchObject({
      errorCode: 'server_error',
      message: 'Elasticsearch search request failed (503, server_error)',
      status: 503,
    });
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
        executedQueryChars: 0,
        index: 'lobehub-dev-agents',
        originalQueryChars: 0,
        pagination: 'bounded',
        queryFieldCount: 0,
        truncated: false,
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
      executedQueryChars: 0,
      index: 'lobehub-dev-agents',
      originalQueryChars: 0,
      pagination: 'bounded' as const,
      queryFieldCount: 0,
      truncated: false,
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
              properties: { fts_search_sync_deleted: { type: 'boolean' } },
            },
          },
          'lobehub-topics-v2': {
            mappings: {
              properties: { fts_search_sync_deleted: { type: 'boolean' } },
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
      'https://search.example.com/lobehub-agents-v2,lobehub-topics-v2?filter_path=*.mappings.properties.fts_search_sync_deleted',
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
                properties: { fts_search_sync_deleted: { type: 'boolean' } },
              },
            },
            'lobehub-topics-v2': {
              mappings: {
                properties: { fts_search_sync_deleted: { type: 'boolean' } },
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
                properties: { fts_search_sync_deleted: { type: 'boolean' } },
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
