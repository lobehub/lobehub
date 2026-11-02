import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import { HTTPStatusError, NetworkConnectionError, PageNotFoundError } from '../../utils/errorType';
import * as withTimeoutModule from '../../utils/withTimeout';
import { anysearch } from '../anysearch';

describe('anysearch crawler', () => {
  const mockFetch = vi.fn();
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = mockFetch;
    originalEnv = { ...process.env };
    delete process.env.ANYSEARCH_API_KEY;
    vi.spyOn(withTimeoutModule, 'withTimeout').mockImplementation((fn) =>
      fn(new AbortController().signal),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('extracts a page anonymously', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse(
        {
          code: 0,
          data: {
            content: '  Extracted page content  ',
            title: 'Example title',
            url: 'https://example.com/final',
          },
          message: 'ok',
          request_id: 'req_extract',
        },
        { ok: true },
      ),
    );

    const result = await anysearch('https://example.com/source', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalledWith('https://api.anysearch.com/v1/extract', {
      body: JSON.stringify({ url: 'https://example.com/source' }),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({
      content: 'Extracted page content',
      contentType: 'text',
      description: 'Example title',
      length: 22,
      siteName: 'example.com',
      title: 'Example title',
      url: 'https://example.com/final',
    });
  });

  it('adds bearer authentication when ANYSEARCH_API_KEY is configured', async () => {
    process.env.ANYSEARCH_API_KEY = 'test-key';
    mockFetch.mockResolvedValue(
      createMockResponse(
        { code: 0, data: { content: 'Content', title: 'Title', url: 'https://example.com' } },
        { ok: true },
      ),
    );

    await anysearch('https://example.com', { filterOptions: {} });

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');
  });

  it('returns undefined for empty extracted content', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse(
        { code: 0, data: { content: '   ', title: 'Title', url: 'https://example.com' } },
        { ok: true },
      ),
    );

    await expect(anysearch('https://example.com', { filterOptions: {} })).resolves.toBeUndefined();
  });

  it('throws for a non-zero AnySearch business code', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ code: 1001, data: {}, message: 'invalid URL' }, { ok: true }),
    );

    await expect(anysearch('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'AnySearch extract failed: invalid URL',
    );
  });

  it('throws PageNotFoundError for HTTP 404', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse('Not Found', { ok: false, status: 404, statusText: 'Not Found' }),
    );

    await expect(anysearch('https://example.com/missing', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('does not expose AnySearch HTTP error response bodies', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse(
        JSON.stringify({ api_key: 'as_sk_generated_secret', message: 'quota exceeded' }),
        { ok: false, status: 402, statusText: 'Payment Required' },
      ),
    );

    let error: unknown;
    try {
      await anysearch('https://example.com', { filterOptions: {} });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HTTPStatusError);
    expect((error as Error).message).toBe(
      'AnySearch request failed with status 402: Payment Required',
    );
    expect((error as Error).message).not.toContain('as_sk_generated_secret');
  });

  it('normalizes fetch failures', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));

    await expect(anysearch('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });
});
