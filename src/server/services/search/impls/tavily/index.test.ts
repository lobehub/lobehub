// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TavilyImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeTavilyResponse = (results: object[], query = 'test') => ({
  query,
  response_time: 0.5,
  results,
});

describe('TavilyImpl', () => {
  let impl: TavilyImpl;

  beforeEach(() => {
    impl = new TavilyImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.TAVILY_API_KEY = 'test-tavily-api-key';
    delete process.env.TAVILY_SEARCH_DEPTH;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_SEARCH_DEPTH;
  });

  describe('query', () => {
    it('should return mapped results for a successful query', async () => {
      const tavilyResults = [
        {
          title: 'Example Title',
          url: 'https://example.com/page',
          content: 'Example content text',
          score: 0.9,
        },
        {
          title: 'Another Result',
          url: 'https://another.com/article',
          content: 'Another content text',
          score: 0.7,
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse(makeTavilyResponse(tavilyResults, 'test query')),
      );

      const result = await impl.query('test query');

      expect(result.query).toBe('test query');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        title: 'Example Title',
        url: 'https://example.com/page',
        content: 'Example content text',
        engines: ['tavily'],
        category: 'general',
        score: 0.9,
        parsedUrl: 'example.com',
      });
    });

    it('should return empty results when results array is empty', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      const result = await impl.query('empty query');

      expect(result.resultNumbers).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should set time_range for day', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test', { searchTimeRange: 'day' });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.time_range).toBe('day');
    });

    it('should set time_range for week', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test', { searchTimeRange: 'week' });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.time_range).toBe('week');
    });

    it('should not set time_range for anytime', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test', { searchTimeRange: 'anytime' });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.time_range).toBeUndefined();
    });

    it('should set topic to news when news category included', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test', { searchCategories: ['news', 'general'] });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.topic).toBe('news');
    });

    it('should set topic to general when general category included', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test', { searchCategories: ['general'] });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.topic).toBe('general');
    });

    it('should not include topic for unsupported categories', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test', { searchCategories: ['images', 'videos'] });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.topic).toBeUndefined();
    });

    it('should use default search_depth basic when env not set', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test');

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.search_depth).toBe('basic');
    });

    it('should use TAVILY_SEARCH_DEPTH from env when set', async () => {
      process.env.TAVILY_SEARCH_DEPTH = 'advanced';

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test');

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.search_depth).toBe('advanced');
    });

    it('should include Bearer token in authorization header', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer test-tavily-api-key',
      );
    });

    it('should use empty string in authorization header when API key not set', async () => {
      delete process.env.TAVILY_API_KEY;

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)['Authorization']).toBe('');
    });

    it('should use POST method', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect(options.method).toBe('POST');
    });

    it('should include query in request body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      await impl.query('my search query');

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.query).toBe('my search query');
      expect(body.max_results).toBe(15);
    });

    it('should throw SERVICE_UNAVAILABLE when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Tavily.',
      });
    });

    it('should throw SERVICE_UNAVAILABLE when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({ error: 'Too Many Requests' }, false, 429, 'Too Many Requests'),
      );

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Tavily request failed: Too Many Requests',
      });
    });

    it('should throw INTERNAL_SERVER_ERROR when response JSON parsing fails', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error('JSON error')),
        text: vi.fn().mockResolvedValue('bad json'),
      } as unknown as Response);

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Tavily response.',
      });
    });

    it('should default score to 0 when not provided', async () => {
      const tavilyResults = [
        {
          title: 'No Score',
          url: 'https://example.com',
          content: 'Content',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse(tavilyResults)));

      const result = await impl.query('test');

      expect(result.results[0].score).toBe(0);
    });

    it('should use topic as category in mapped results', async () => {
      const tavilyResults = [
        {
          title: 'News Article',
          url: 'https://example.com',
          content: 'News content',
          score: 0.8,
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse(tavilyResults)));

      const result = await impl.query('test', { searchCategories: ['news'] });

      expect(result.results[0].category).toBe('news');
    });

    it('should default category to general when topic not set', async () => {
      const tavilyResults = [
        {
          title: 'Article',
          url: 'https://example.com',
          content: 'Content',
          score: 0.8,
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse(tavilyResults)));

      const result = await impl.query('test');

      expect(result.results[0].category).toBe('general');
    });

    it('should correctly parse parsedUrl from result url', async () => {
      const tavilyResults = [
        {
          title: 'Test',
          url: 'https://www.example.co.uk/path',
          content: 'Content',
          score: 0.5,
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse(tavilyResults)));

      const result = await impl.query('test');

      expect(result.results[0].parsedUrl).toBe('www.example.co.uk');
    });

    it('should include costTime in the response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeTavilyResponse([])));

      const result = await impl.query('test');

      expect(typeof result.costTime).toBe('number');
      expect(result.costTime).toBeGreaterThanOrEqual(0);
    });
  });
});
