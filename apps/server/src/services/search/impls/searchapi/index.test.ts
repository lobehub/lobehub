// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchAPIImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeSearchApiResponse = (results: object[], query = 'test') => ({
  organic_results: results,
  search_metadata: { id: 'abc', status: 'Success' },
  search_parameters: { engine: 'google', q: query },
});

const requestedUrl = (callIndex = 0): URL =>
  new URL(vi.mocked(fetch).mock.calls[callIndex][0] as string);

describe('SearchAPIImpl', () => {
  let impl: SearchAPIImpl;

  beforeEach(() => {
    impl = new SearchAPIImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.SEARCHAPI_API_KEY = 'test-searchapi-key';
    delete process.env.SEARCHAPI_ENGINE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SEARCHAPI_API_KEY;
    delete process.env.SEARCHAPI_ENGINE;
  });

  describe('query', () => {
    it('should return mapped results for a successful query', async () => {
      const results = [
        {
          link: 'https://example.com/page',
          position: 1,
          snippet: 'Example snippet',
          title: 'Example Title',
        },
        {
          link: 'https://another.com/article',
          position: 2,
          snippet: 'Another snippet',
          title: 'Another Result',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse(results)));

      const result = await impl.query('test query');

      expect(result.query).toBe('test query');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        category: 'general',
        content: 'Example snippet',
        engines: ['google'],
        parsedUrl: 'example.com',
        score: 0,
        title: 'Example Title',
        url: 'https://example.com/page',
      });
      expect(typeof result.costTime).toBe('number');
    });

    it('should return empty results when no result array is populated', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ search_metadata: {} }));

      const result = await impl.query('empty query');

      expect(result.resultNumbers).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should send the query and the default engine to the search endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse([])));

      await impl.query('my search query');

      const url = requestedUrl();
      expect(url.origin + url.pathname).toBe('https://www.searchapi.io/api/v1/search');
      expect(url.searchParams.get('engine')).toBe('google');
      expect(url.searchParams.get('q')).toBe('my search query');
    });

    it('should send the API key as the api_key query parameter', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse([])));

      await impl.query('test');

      expect(requestedUrl().searchParams.get('api_key')).toBe('test-searchapi-key');
    });

    it('should omit api_key when the API key is not configured', async () => {
      delete process.env.SEARCHAPI_API_KEY;

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse([])));

      await impl.query('test');

      expect(requestedUrl().searchParams.get('api_key')).toBeNull();
    });

    it('should use a GET request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse([])));

      await impl.query('test');

      expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe('GET');
    });

    it('should use the Google News engine for a news request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse([])));

      await impl.query('test', { searchCategories: ['news'] });

      expect(requestedUrl().searchParams.get('engine')).toBe('google_news');
    });

    it('should label news results with a news category', async () => {
      const results = [{ link: 'https://example.com', snippet: 'Body', title: 'Headline' }];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse(results)));

      const result = await impl.query('test', { searchCategories: ['news'] });

      expect(result.results[0].category).toBe('news');
    });

    it('should let SEARCHAPI_ENGINE override the engine choice', async () => {
      process.env.SEARCHAPI_ENGINE = 'bing';

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse([])));

      await impl.query('test', { searchCategories: ['news'] });

      expect(requestedUrl().searchParams.get('engine')).toBe('bing');
    });

    it('should read the videos array for a video engine', async () => {
      process.env.SEARCHAPI_ENGINE = 'youtube';

      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse({
          videos: [
            {
              link: 'https://youtube.com/watch?v=1',
              thumbnail: 'https://t/1.jpg',
              title: 'A video',
            },
          ],
        }),
      );

      const result = await impl.query('test');

      expect(result.resultNumbers).toBe(1);
      expect(result.results[0]).toMatchObject({
        engines: ['youtube'],
        thumbnail: 'https://t/1.jpg',
        title: 'A video',
        url: 'https://youtube.com/watch?v=1',
      });
    });

    it('should read the shopping results array', async () => {
      process.env.SEARCHAPI_ENGINE = 'google_shopping';

      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse({
          shopping_results: [{ link: 'https://shop.example.com/p', title: 'A product' }],
        }),
      );

      const result = await impl.query('test');

      expect(result.resultNumbers).toBe(1);
      expect(result.results[0].title).toBe('A product');
    });

    it('should prefer organic results when several arrays are populated', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse({
          jobs: [{ link: 'https://jobs.example.com', title: 'A job' }],
          organic_results: [{ link: 'https://organic.example.com', title: 'Organic' }],
        }),
      );

      const result = await impl.query('test');

      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Organic');
    });

    it.each([
      ['day', 'last_day'],
      ['week', 'last_week'],
      ['month', 'last_month'],
      ['year', 'last_year'],
    ])('should map the %s time range to %s', async (searchTimeRange, expected) => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse([])));

      await impl.query('test', { searchTimeRange });

      expect(requestedUrl().searchParams.get('time_period')).toBe(expected);
    });

    it('should not send a time period for anytime', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse([])));

      await impl.query('test', { searchTimeRange: 'anytime' });

      expect(requestedUrl().searchParams.get('time_period')).toBeNull();
    });

    it('should fall back to the description for content', async () => {
      const results = [
        {
          date: '2 hours ago',
          description: 'Description body',
          link: 'https://news.example.com/story',
          title: 'A story',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse(results)));

      const result = await impl.query('test');

      expect(result.results[0].content).toBe('Description body');
      expect(result.results[0].publishedDate).toBe('2 hours ago');
    });

    it('should read the publication date from published_date as well', async () => {
      const results = [
        { link: 'https://example.com', published_date: '2026-01-02', title: 'A video' },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSearchApiResponse(results)));

      const result = await impl.query('test');

      expect(result.results[0].publishedDate).toBe('2026-01-02');
    });

    it('should leave parsedUrl empty for an unparsable link', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse(makeSearchApiResponse([{ link: 'not-a-url', title: 'Bad link' }])),
      );

      const result = await impl.query('test');

      expect(result.results[0].parsedUrl).toBe('');
      expect(result.results[0].url).toBe('not-a-url');
    });

    it('should throw SERVICE_UNAVAILABLE when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to SearchApi.',
      });
    });

    it('should throw SERVICE_UNAVAILABLE when the response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({ error: 'Invalid API key.' }, false, 401, 'Unauthorized'),
      );

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'SearchApi request failed: Unauthorized',
      });
    });

    it('should throw SERVICE_UNAVAILABLE when the body reports an error', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({ error: 'Invalid API key.' }, true, 200, 'OK'),
      );

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'SearchApi request failed: Invalid API key.',
      });
    });

    it('should throw INTERNAL_SERVER_ERROR when the response body is not JSON', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error('JSON error')),
        text: vi.fn().mockResolvedValue('bad json'),
      } as unknown as Response);

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse SearchApi response.',
      });
    });
  });
});
