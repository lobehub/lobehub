// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildFtsSearchIndexMeta,
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
} from '../../../../packages/database/src/repositories/ftsSearchDocument';
import { FtsSearchReindexHttpClient, parseGenerationVersion } from '../elasticsearchClient';
import type { FtsSearchReindexIndexBody } from '../reindexService';

const response = (body: unknown, status = 200) =>
  new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const reindexMeta = buildFtsSearchIndexMeta('agents', '00000000-0000-4000-8000-000000000001');
const agentsIndexBody: FtsSearchReindexIndexBody = {
  mappings: { ...FTS_SEARCH_INDEX_DEFINITIONS.agents.mappings, _meta: reindexMeta },
  settings: { analysis: FTS_SEARCH_INDEX_ANALYSIS },
};
const existingAgentsMapping = {
  'lobehub-messages-v1': {
    mappings: {
      _meta: reindexMeta,
      ...FTS_SEARCH_INDEX_DEFINITIONS.agents.mappings,
    },
  },
};
afterEach(() => vi.unstubAllGlobals());

describe('FtsSearchReindexHttpClient', () => {
  it('rejects remote HTTP endpoints before exposing the API key', () => {
    expect(
      () =>
        new FtsSearchReindexHttpClient({
          apiKey: 'secret-key',
          url: 'http://search.example.com',
        }),
    ).toThrow('must use HTTPS unless it targets loopback');
  });

  it('allows loopback HTTP endpoints for local development', () => {
    expect(
      () =>
        new FtsSearchReindexHttpClient({
          apiKey: 'secret-key',
          url: 'http://localhost:9200',
        }),
    ).not.toThrow();
  });

  it('rejects an API key over plaintext HTTP even when insecure HTTP is allowed', () => {
    expect(
      () =>
        new FtsSearchReindexHttpClient({
          allowInsecureHttp: true,
          apiKey: 'secret-key',
          url: 'http://elasticsearch:9200',
        }),
    ).toThrow('must not be sent over plaintext HTTP');
  });

  it('requires an API key unless insecure private-network access is explicitly allowed', () => {
    expect(() => new FtsSearchReindexHttpClient({ url: 'https://search.example.com' })).toThrow(
      'API key is required unless ES_ALLOW_INSECURE_HTTP=true',
    );
  });

  it('sends unauthenticated requests to an explicitly insecure private-network endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ count: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      allowInsecureHttp: true,
      url: 'http://elasticsearch:9200',
    });

    await expect(client.count('lobehub-agents-v1')).resolves.toBe(3);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe('http://elasticsearch:9200/lobehub-agents-v1/_count');
    expect(Object.keys(init.headers)).not.toContain('Authorization');
  });

  it('creates a missing index without exposing credentials in the URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined, 404))
      .mockResolvedValueOnce(response({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
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
    const client = new FtsSearchReindexHttpClient({
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
              ...FTS_SEARCH_INDEX_ANALYSIS,
              analyzer: {
                ...FTS_SEARCH_INDEX_ANALYSIS.analyzer,
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
    const client = new FtsSearchReindexHttpClient({
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
            settings: { index: { analysis: FTS_SEARCH_INDEX_ANALYSIS } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
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
                ...FTS_SEARCH_INDEX_DEFINITIONS.agents.mappings.properties,
                id: { type: 'text' },
              },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
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
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureIndex('lobehub-messages-v1', agentsIndexBody)).rejects.toThrow(
      'reindex run identity is incompatible',
    );
  });

  it('resumes a legacy index whose _meta predates schema fingerprints', async () => {
    const { schema_fingerprint: _fingerprint, ...legacyMeta } = reindexMeta;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: { _meta: legacyMeta, ...FTS_SEARCH_INDEX_DEFINITIONS.agents.mappings },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            settings: { index: { analysis: FTS_SEARCH_INDEX_ANALYSIS } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.ensureIndex('lobehub-messages-v1', agentsIndexBody),
    ).resolves.toBeUndefined();
  });

  it('refuses to resume an index built from a drifted mapping of the same schema version', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: {
              _meta: { ...reindexMeta, schema_fingerprint: 'f'.repeat(64) },
              ...FTS_SEARCH_INDEX_DEFINITIONS.agents.mappings,
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureIndex('lobehub-messages-v1', agentsIndexBody)).rejects.toThrow(
      'was built from a different v1 mapping than the code declares',
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
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureAlias('lobehub-messages', 'lobehub-messages-v1')).resolves.toBe(
      'existing',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://search.example.com/_alias/lobehub-messages',
    );
  });

  it('keeps an alias that targets the expected index without an explicit write flag', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ 'lobehub-messages-v1': { aliases: { 'lobehub-messages': {} } } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureAlias('lobehub-messages', 'lobehub-messages-v1')).resolves.toBe(
      'existing',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps an alias that still serves another generation of the same entity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        'lobehub-messages-v1': {
          aliases: { 'lobehub-messages': { is_write_index: true } },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureAlias('lobehub-messages', 'lobehub-messages-v2')).resolves.toBe(
      'kept_other_generation',
    );
    // Promotion is an explicit later step, so the backfill must not mutate the alias here.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://search.example.com/_alias/lobehub-messages',
    );
  });

  it('refuses an alias that targets an index outside the generation naming scheme', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        'legacy-messages-index': {
          aliases: { 'lobehub-messages': { is_write_index: true } },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureAlias('lobehub-messages', 'lobehub-messages-v2')).rejects.toThrow(
      'Elasticsearch alias lobehub-messages points to legacy-messages-index instead of a single writable lobehub-messages-v<n> generation',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('creates a missing alias as the write index of the given generation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined, 404))
      .mockResolvedValueOnce(response({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.ensureAlias('lobehub-messages', 'lobehub-messages-v2')).resolves.toBe(
      'created',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [endpoint, init] = fetchMock.mock.calls[1];
    expect(String(endpoint)).toBe('https://search.example.com/_aliases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      actions: [
        { add: { alias: 'lobehub-messages', index: 'lobehub-messages-v2', is_write_index: true } },
      ],
    });
  });

  it('describes open and closed generations of an alias', async () => {
    const openDetail = {
      'lobehub-messages-v2': {
        mappings: {
          _meta: { ...reindexMeta, schema_version: 2 },
          dynamic: 'strict',
          properties: { id: { type: 'keyword' } },
        },
        settings: { index: { analysis: FTS_SEARCH_INDEX_ANALYSIS } },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response([
          { index: 'lobehub-messages-v2', status: 'open' },
          { index: 'lobehub-messages-v1', status: 'close' },
        ]),
      )
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v2': { aliases: { 'lobehub-messages': { is_write_index: true } } },
        }),
      )
      .mockResolvedValueOnce(response(openDetail));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.describeGenerations('lobehub-messages')).resolves.toEqual([
      {
        aliased: false,
        analysis: null,
        index: 'lobehub-messages-v1',
        isWriteIndex: false,
        mappings: null,
        meta: null,
        state: 'closed',
        version: 1,
      },
      {
        aliased: true,
        analysis: FTS_SEARCH_INDEX_ANALYSIS,
        index: 'lobehub-messages-v2',
        isWriteIndex: true,
        mappings: openDetail['lobehub-messages-v2'].mappings,
        meta: { ...reindexMeta, schema_version: 2 },
        state: 'open',
        version: 2,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://search.example.com/_cat/indices/lobehub-messages-v*?format=json&h=index,status&expand_wildcards=all&allow_no_indices=true',
    );
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://search.example.com/_alias/lobehub-messages',
    );
    // The closed generation cannot answer a mapping request, so only open ones are inspected.
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      'https://search.example.com/lobehub-messages-v2?filter_path=*.mappings,*.settings.index.analysis',
    );
  });

  it('describes generations of an entity whose alias does not exist yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([{ index: 'lobehub-messages-v1', status: 'open' }]))
      .mockResolvedValueOnce(response(undefined, 404))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: { _meta: reindexMeta, dynamic: 'strict', properties: {} },
            settings: { index: { analysis: FTS_SEARCH_INDEX_ANALYSIS } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.describeGenerations('lobehub-messages')).resolves.toEqual([
      {
        aliased: false,
        analysis: FTS_SEARCH_INDEX_ANALYSIS,
        index: 'lobehub-messages-v1',
        isWriteIndex: false,
        mappings: { _meta: reindexMeta, dynamic: 'strict', properties: {} },
        meta: reindexMeta,
        state: 'open',
        version: 1,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('describes no generation when the entity has no physical index', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response(undefined, 404));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.describeGenerations('lobehub-messages')).resolves.toEqual([]);
    // Without an open index there is nothing to inspect, so no detail request is issued.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a listed index that is outside the generation naming scheme', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response([
          { index: 'lobehub-messages-vnext', status: 'open' },
          { index: 'lobehub-messages-v3', status: 'open' },
        ]),
      )
      .mockResolvedValueOnce(response(undefined, 404))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v3': {
            mappings: { _meta: reindexMeta, dynamic: 'strict', properties: {} },
            settings: { index: { analysis: FTS_SEARCH_INDEX_ANALYSIS } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    const generations = await client.describeGenerations('lobehub-messages');

    expect(generations.map(({ index }) => index)).toEqual(['lobehub-messages-v3']);
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      'https://search.example.com/lobehub-messages-v3?filter_path=*.mappings,*.settings.index.analysis',
    );
  });

  it('describes an aliased index that is outside the generation naming scheme', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(
        response({ 'lobehub-messages-legacy': { aliases: { 'lobehub-messages': {} } } }),
      )
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-legacy': {
            mappings: { _meta: reindexMeta, dynamic: 'strict', properties: {} },
            settings: { index: { analysis: FTS_SEARCH_INDEX_ANALYSIS } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.describeGenerations('lobehub-messages')).resolves.toMatchObject([
      {
        aliased: true,
        index: 'lobehub-messages-legacy',
        isWriteIndex: true,
        state: 'open',
        version: null,
      },
    ]);
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      'https://search.example.com/lobehub-messages-legacy?filter_path=*.mappings,*.settings.index.analysis',
    );
  });

  it('reports the stamped generation of an index upgraded in place', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([{ index: 'lobehub-messages-v1', status: 'open' }]))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': { aliases: { 'lobehub-messages': { is_write_index: true } } },
        }),
      )
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: {
              _meta: { ...reindexMeta, schema_version: 2 },
              dynamic: 'strict',
              properties: {},
            },
            settings: { index: { analysis: FTS_SEARCH_INDEX_ANALYSIS } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    // The `-v1` suffix only records which generation built the index, not the one it implements.
    await expect(client.describeGenerations('lobehub-messages')).resolves.toMatchObject([
      { index: 'lobehub-messages-v1', isWriteIndex: true, version: 2 },
    ]);
  });

  it('reports no generation for a stamped index outside the naming scheme', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(
        response({ 'lobehub-messages-restored': { aliases: { 'lobehub-messages': {} } } }),
      )
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-restored': {
            mappings: {
              _meta: { ...reindexMeta, schema_version: 3 },
              dynamic: 'strict',
              properties: {},
            },
            settings: { index: { analysis: FTS_SEARCH_INDEX_ANALYSIS } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.describeGenerations('lobehub-messages')).resolves.toMatchObject([
      { index: 'lobehub-messages-restored', meta: { schema_version: 3 }, version: null },
    ]);
  });

  it('applies an additive mapping upgrade to a live index', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.putMapping('lobehub-messages-v1', {
        _meta: reindexMeta,
        properties: FTS_SEARCH_INDEX_DEFINITIONS.agents.mappings.properties,
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe('https://search.example.com/lobehub-messages-v1/_mapping');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      _meta: reindexMeta,
      properties: FTS_SEARCH_INDEX_DEFINITIONS.agents.mappings.properties,
    });
  });

  it('reports a rejected mapping upgrade', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: 'illegal_argument' }, 400));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.putMapping('lobehub-messages-v1', {
        _meta: reindexMeta,
        properties: FTS_SEARCH_INDEX_DEFINITIONS.agents.mappings.properties,
      }),
    ).rejects.toThrow('Elasticsearch mapping upgrade failed for lobehub-messages-v1 (400)');
  });

  it('promotes a generation and removes the alias from every previous generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.promoteAlias(
        'lobehub-messages',
        ['lobehub-messages-v1', 'lobehub-messages-v2'],
        'lobehub-messages-v3',
      ),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe('https://search.example.com/_aliases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      actions: [
        { remove: { alias: 'lobehub-messages', index: 'lobehub-messages-v1' } },
        { remove: { alias: 'lobehub-messages', index: 'lobehub-messages-v2' } },
        { add: { alias: 'lobehub-messages', index: 'lobehub-messages-v3', is_write_index: true } },
      ],
    });
  });

  it('does not remove the alias from the generation it promotes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await client.promoteAlias(
      'lobehub-messages',
      ['lobehub-messages-v1', 'lobehub-messages-v2'],
      'lobehub-messages-v2',
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      actions: [
        { remove: { alias: 'lobehub-messages', index: 'lobehub-messages-v1' } },
        { add: { alias: 'lobehub-messages', index: 'lobehub-messages-v2', is_write_index: true } },
      ],
    });
  });

  it('closes a retired generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.closeIndex('lobehub-messages-v1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe('https://search.example.com/lobehub-messages-v1/_close');
    expect(init.method).toBe('POST');
  });

  it('reports a failed close of a retired generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: 'forbidden' }, 403));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.closeIndex('lobehub-messages-v1')).rejects.toThrow(
      'Elasticsearch index close failed for lobehub-messages-v1 (403)',
    );
  });

  it('deletes a retired generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.deleteIndex('lobehub-messages-v1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe('https://search.example.com/lobehub-messages-v1');
    expect(init.method).toBe('DELETE');
  });

  it('reports a failed deletion of a retired generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: 'not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FtsSearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(client.deleteIndex('lobehub-messages-v1')).rejects.toThrow(
      'Elasticsearch index deletion failed for lobehub-messages-v1 (404)',
    );
  });
});

describe('parseGenerationVersion', () => {
  it('parses the generation of an index that follows the alias naming scheme', () => {
    expect(parseGenerationVersion('lobehub-messages', 'lobehub-messages-v1')).toBe(1);
    expect(parseGenerationVersion('lobehub-messages', 'lobehub-messages-v12')).toBe(12);
  });

  it('returns undefined for an index outside the alias naming scheme', () => {
    expect(parseGenerationVersion('lobehub-messages', 'lobehub-messages')).toBeUndefined();
    expect(parseGenerationVersion('lobehub-messages', 'lobehub-messages-vnext')).toBeUndefined();
    expect(
      parseGenerationVersion('lobehub-messages', 'lobehub-messages-v1-restored'),
    ).toBeUndefined();
  });

  it('returns undefined for a generation of a foreign alias prefix', () => {
    expect(parseGenerationVersion('lobehub-messages', 'lobehub-agents-v1')).toBeUndefined();
    expect(
      parseGenerationVersion('lobehub-messages', 'shadow-lobehub-messages-v1'),
    ).toBeUndefined();
  });
});
