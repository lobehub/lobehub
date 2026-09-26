// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnySearchImpl } from './index';

const createMockResponse = (body: unknown, ok = true, status = 200, statusText = 'OK') =>
  ({
    json: vi.fn().mockResolvedValue(body),
    ok,
    status,
    statusText,
  }) as unknown as Response;

const makeResponse = (results: object[] = []) => ({
  code: 0,
  data: {
    metadata: { search_time_ms: 42, total_results: results.length },
    results,
  },
  message: 'ok',
  request_id: 'req_test',
});

describe('AnySearchImpl', () => {
  let impl: AnySearchImpl;

  beforeEach(() => {
    impl = new AnySearchImpl();
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.ANYSEARCH_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANYSEARCH_API_KEY;
  });

  it('maps AnySearch results to the uniform search response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse(
        makeResponse([
          {
            content: 'Full content',
            snippet: 'Snippet',
            title: 'Example',
            url: 'https://example.com/page',
          },
        ]),
      ),
    );

    const result = await impl.query('test query');

    expect(result).toEqual({
      costTime: 42,
      query: 'test query',
      resultNumbers: 1,
      results: [
        {
          category: 'general',
          content: 'Full content',
          engines: ['anysearch'],
          parsedUrl: 'example.com',
          score: 0,
          title: 'Example',
          url: 'https://example.com/page',
        },
      ],
    });
  });

  it('uses snippet when content is absent and drops non-citeable results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse(
        makeResponse([
          { snippet: 'Useful snippet', title: 'Useful', url: 'https://example.com/result' },
          { content: 'Structured data only', title: 'No URL' },
          { title: 'Invalid URL', url: 'javascript:alert(1)' },
        ]),
      ),
    );

    const result = await impl.query('test');

    expect(result.resultNumbers).toBe(1);
    expect(result.results[0].content).toBe('Useful snippet');
  });

  it('supports anonymous search by omitting Authorization when no API key is configured', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeResponse()));

    await impl.query('anonymous query');

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('uses bearer authentication when ANYSEARCH_API_KEY is configured', async () => {
    process.env.ANYSEARCH_API_KEY = 'test-key';
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeResponse()));

    await impl.query('authenticated query');

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://api.anysearch.com/v1/search',
      expect.objectContaining({
        body: JSON.stringify({ max_results: 10, query: 'authenticated query' }),
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        method: 'POST',
      }),
    );
  });

  it('does not forward LobeHub engine restrictions', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeResponse()));

    await impl.query('test', { searchEngines: ['google', 'bing'] });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({ max_results: 10, query: 'test' });
    expect(impl.useAutoSearchEngineSelection).toBe(true);
  });

  it('throws on a non-zero AnySearch business code', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse({ code: 1001, data: {}, message: 'invalid request' }),
    );

    await expect(impl.query('test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'AnySearch request failed: invalid request',
    });
  });

  it('throws SERVICE_UNAVAILABLE for an HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({}, false, 429, 'Too Many Requests'));

    await expect(impl.query('test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'AnySearch request failed: Too Many Requests',
    });
  });

  it('throws SERVICE_UNAVAILABLE when fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(impl.query('test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Failed to connect to AnySearch.',
    });
  });
});
