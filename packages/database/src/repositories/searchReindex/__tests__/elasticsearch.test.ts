import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchReindexHttpClient } from '../elasticsearch';

const response = (body: unknown, status = 200) =>
  new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

afterEach(() => vi.unstubAllGlobals());

describe('SearchReindexHttpClient', () => {
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

    await client.ensureIndex('lobehub-messages-v1', {
      mappings: { dynamic: 'strict', properties: {} },
      settings: { analysis: { analyzer: {}, filter: {}, tokenizer: {} } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://search.example.com/lobehub-messages-v1',
    );
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('secret-key');
  });

  it('refuses to resume into an existing index with an incompatible mapping', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(
        response({
          'lobehub-messages-v1': {
            mappings: { dynamic: 'strict', properties: { id: { type: 'text' } } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new SearchReindexHttpClient({
      apiKey: 'secret-key',
      url: 'https://search.example.com',
    });

    await expect(
      client.ensureIndex('lobehub-messages-v1', {
        mappings: { dynamic: 'strict', properties: { id: { type: 'keyword' } } },
        settings: { analysis: { analyzer: {}, filter: {}, tokenizer: {} } },
      }),
    ).rejects.toThrow('mapping is incompatible for id');
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
