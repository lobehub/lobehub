// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Search1APIImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeSearch1ApiResponse = (searchParameters: Record<string, unknown> = {}) => ({
  results: [
    {
      data: {
        results: [
          {
            link: 'https://example.com/page',
            snippet: 'Example snippet',
            title: 'Example result',
          },
        ],
        searchParameters,
      },
      success: true,
    },
  ],
});

describe('Search1APIImpl', () => {
  let impl: Search1APIImpl;

  beforeEach(() => {
    impl = new Search1APIImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.SEARCH1API_SEARCH_API_KEY = 'test-search1api-key';
    delete process.env.SEARCH1API_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SEARCH1API_SEARCH_API_KEY;
    delete process.env.SEARCH1API_API_KEY;
  });

  it('should advertise automatic engine selection', () => {
    expect(impl.useAutoSearchEngineSelection).toBe(true);
  });

  it('should use auto mode even when searchEngines are provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ results: [] }));

    await impl.query('TypeScript', { searchEngines: ['google', 'bing'] });

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      crawl_results: 0,
      image: false,
      max_results: 15,
      query: 'TypeScript',
    });
    expect(body[0].search_service).toBeUndefined();
  });

  it('should keep time range while using auto mode', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ results: [] }));

    await impl.query('latest AI news', {
      searchEngines: ['google'],
      searchTimeRange: 'week',
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);

    expect(body[0].search_service).toBeUndefined();
    expect(body[0].time_range).toBe('month');
  });

  it('should not emit an empty engine for auto results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse(makeSearch1ApiResponse({ query: 'test' })),
    );

    const result = await impl.query('test');

    expect(result.results[0]).toMatchObject({
      content: 'Example snippet',
      engines: [],
      parsedUrl: 'example.com',
      title: 'Example result',
      url: 'https://example.com/page',
    });
  });

  it('should preserve the returned engine when Search1API includes one', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse(makeSearch1ApiResponse({ query: 'test', search_service: 'google' })),
    );

    const result = await impl.query('test');

    expect(result.results[0].engines).toEqual(['google']);
  });
});
