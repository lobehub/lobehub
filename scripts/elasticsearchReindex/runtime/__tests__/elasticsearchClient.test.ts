// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  getFtsSearchIndexMappings,
} from '../../../../packages/database/src/repositories/ftsSearchDocument';
import { FtsSearchReindexHttpClient } from '../elasticsearchClient';
import type { FtsSearchReindexAliasTarget, FtsSearchReindexIndexBody } from '../reindexService';

const response = (body: unknown, status = 200) =>
  new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const reindexMeta = { reindex_run_id: '00000000-0000-4000-8000-000000000001', schema_version: 1 };
const agentsMappings = getFtsSearchIndexMappings('agents');
const agentsIndexBody: FtsSearchReindexIndexBody = {
  mappings: { ...agentsMappings, _meta: reindexMeta },
  settings: { analysis: FTS_SEARCH_INDEX_ANALYSIS },
};
const existingAgentsMapping = {
  'lobehub-messages-v1': {
    mappings: {
      _meta: reindexMeta,
      ...agentsMappings,
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
              _source: { excludes: agentsMappings._source.excludes },
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

  it('refuses to resume into an existing index with different _source excludes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: {
              _meta: reindexMeta,
              _source: { excludes: [] },
              dynamic: 'strict',
              properties: agentsMappings.properties,
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
      '_source excludes are incompatible',
    );
  });

  it('accepts an existing index whose _source excludes only differ in order', async () => {
    const messagesMappings = getFtsSearchIndexMappings('messages');
    const messagesIndexBody: FtsSearchReindexIndexBody = {
      mappings: { ...messagesMappings, _meta: reindexMeta },
      settings: { analysis: FTS_SEARCH_INDEX_ANALYSIS },
    };
    expect(messagesMappings._source.excludes.length).toBeGreaterThan(1);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: {
              _meta: reindexMeta,
              _source: { excludes: [...messagesMappings._source.excludes].reverse() },
              dynamic: 'strict',
              properties: messagesMappings.properties,
            },
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
      client.ensureIndex('lobehub-messages-v1', messagesIndexBody),
    ).resolves.toBeUndefined();
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

    await expect(
      client.ensureAlias('lobehub-messages', 'lobehub-messages-v1'),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses to advance an alias that targets an older schema version', async () => {
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

    await expect(client.ensureAlias('lobehub-messages', 'lobehub-messages-v2')).rejects.toThrow(
      'Elasticsearch alias lobehub-messages already points to a different index',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  describe('resolveAliasTarget', () => {
    it('returns null when the alias does not exist yet (404)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(response(undefined, 404));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.resolveAliasTarget('lobehub-agents')).resolves.toBeNull();
    });

    it('returns the physical index when the alias has exactly one target', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        response({
          'lobehub-agents-v1': {
            aliases: { 'lobehub-agents': { is_write_index: true } },
          },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.resolveAliasTarget('lobehub-agents')).resolves.toBe('lobehub-agents-v1');
    });

    it('throws when the alias points to multiple indices', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        response({
          'lobehub-agents-v1': { aliases: { 'lobehub-agents': {} } },
          'lobehub-agents-v2': { aliases: { 'lobehub-agents': { is_write_index: true } } },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.resolveAliasTarget('lobehub-agents')).rejects.toThrow(
        'points to multiple indices',
      );
    });
  });

  describe('switchAliases', () => {
    const targets: FtsSearchReindexAliasTarget[] = [
      { alias: 'lobehub-agents', physicalIndex: 'lobehub-agents-v2' },
      { alias: 'lobehub-messages', physicalIndex: 'lobehub-messages-v2' },
    ];

    it('sends a single /_aliases request that removes old indices and adds the new write index', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response({
            'lobehub-agents-v1': { aliases: { 'lobehub-agents': { is_write_index: true } } },
          }),
        )
        .mockResolvedValueOnce(
          response({
            'lobehub-messages-v1': { aliases: { 'lobehub-messages': { is_write_index: true } } },
          }),
        )
        .mockResolvedValueOnce(response({ acknowledged: true }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await client.switchAliases(targets);

      const aliasCalls = fetchMock.mock.calls.filter(([endpoint]) =>
        String(endpoint).endsWith('/_aliases'),
      );
      expect(aliasCalls).toHaveLength(1);
      const [, init] = aliasCalls[0];
      expect(JSON.parse(init.body)).toEqual({
        actions: [
          { remove: { alias: 'lobehub-agents', index: 'lobehub-agents-v1' } },
          { add: { alias: 'lobehub-agents', index: 'lobehub-agents-v2', is_write_index: true } },
          { remove: { alias: 'lobehub-messages', index: 'lobehub-messages-v1' } },
          {
            add: { alias: 'lobehub-messages', index: 'lobehub-messages-v2', is_write_index: true },
          },
        ],
      });
    });

    it('only adds the new index when an alias does not exist yet (404)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response(undefined, 404))
        .mockResolvedValueOnce(response(undefined, 404))
        .mockResolvedValueOnce(response({ acknowledged: true }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await client.switchAliases(targets);

      const [, init] = fetchMock.mock.calls.at(-1)!;
      expect(JSON.parse(init.body)).toEqual({
        actions: [
          { add: { alias: 'lobehub-agents', index: 'lobehub-agents-v2', is_write_index: true } },
          {
            add: { alias: 'lobehub-messages', index: 'lobehub-messages-v2', is_write_index: true },
          },
        ],
      });
    });

    it('skips the remove action when the alias already targets the new physical index', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response({
            'lobehub-agents-v2': { aliases: { 'lobehub-agents': { is_write_index: true } } },
          }),
        )
        .mockResolvedValueOnce(response(undefined, 404))
        .mockResolvedValueOnce(response({ acknowledged: true }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await client.switchAliases(targets);

      const [, init] = fetchMock.mock.calls.at(-1)!;
      expect(JSON.parse(init.body)).toEqual({
        actions: [
          { add: { alias: 'lobehub-agents', index: 'lobehub-agents-v2', is_write_index: true } },
          {
            add: { alias: 'lobehub-messages', index: 'lobehub-messages-v2', is_write_index: true },
          },
        ],
      });
    });

    it('throws when the /_aliases request does not respond ok', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response(undefined, 404))
        .mockResolvedValueOnce(response(undefined, 404))
        .mockResolvedValueOnce(response(undefined, 500));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.switchAliases(targets)).rejects.toThrow(
        'Elasticsearch alias switch failed',
      );
    });
  });

  describe('startReindex', () => {
    it('starts an external-version, conflict-tolerant reindex without waiting for completion', async () => {
      const fetchMock = vi.fn().mockResolvedValue(response({ task: 'node1:123' }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.startReindex('lobehub-agents-v1', 'lobehub-agents-v2')).resolves.toBe(
        'node1:123',
      );

      expect(fetchMock).toHaveBeenCalledOnce();
      const [endpoint, init] = fetchMock.mock.calls[0];
      expect(String(endpoint)).toBe(
        'https://search.example.com/_reindex?wait_for_completion=false',
      );
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        conflicts: 'proceed',
        dest: { index: 'lobehub-agents-v2', version_type: 'external' },
        source: { index: 'lobehub-agents-v1' },
      });
    });

    it('throws when the reindex start request fails', async () => {
      const fetchMock = vi.fn().mockResolvedValue(response(undefined, 500));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.startReindex('lobehub-agents-v1', 'lobehub-agents-v2')).rejects.toThrow(
        'Elasticsearch reindex start failed',
      );
    });

    it('rejects an invalid reindex start response shape', async () => {
      const fetchMock = vi.fn().mockResolvedValue(response({ task: 123 }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.startReindex('lobehub-agents-v1', 'lobehub-agents-v2')).rejects.toThrow(
        'reindex start response has an invalid shape',
      );
    });
  });

  describe('getTask', () => {
    it('maps a running task with missing counters and failures to defaults', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(response({ completed: false, task: { status: {} } }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.getTask('node1:123')).resolves.toEqual({
        completed: false,
        created: 0,
        failures: [],
        total: 0,
        updated: 0,
        versionConflicts: 0,
      });
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'https://search.example.com/_tasks/node1%3A123',
      );
    });

    it('maps a completed task with reported counters and failures', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        response({
          completed: true,
          response: { failures: [{ id: 'doc-1' }] },
          task: { status: { created: 5, total: 10, updated: 3, version_conflicts: 2 } },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.getTask('node1:123')).resolves.toEqual({
        completed: true,
        created: 5,
        failures: [{ id: 'doc-1' }],
        total: 10,
        updated: 3,
        versionConflicts: 2,
      });
    });

    it('throws when a completed task reports an error', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        response({
          completed: true,
          error: { reason: 'process was killed' },
          task: { status: {} },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.getTask('node1:123')).rejects.toThrow(
        'Elasticsearch reindex task node1:123 failed',
      );
    });

    it('throws when the task lookup request fails', async () => {
      const fetchMock = vi.fn().mockResolvedValue(response(undefined, 404));
      vi.stubGlobal('fetch', fetchMock);
      const client = new FtsSearchReindexHttpClient({
        apiKey: 'secret-key',
        url: 'https://search.example.com',
      });

      await expect(client.getTask('node1:123')).rejects.toThrow('Elasticsearch task lookup failed');
    });
  });
});
