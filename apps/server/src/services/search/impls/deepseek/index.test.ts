// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeepSeekImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    json: vi.fn().mockResolvedValue(body),
    ok,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeDeepSeekResponse = (results: object[]) => ({
  results,
});

describe('DeepSeekImpl', () => {
  let impl: DeepSeekImpl;

  beforeEach(() => {
    impl = new DeepSeekImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.DEEPSEEK_SEARCH_API_KEY = 'test-deepseek-search-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_SEARCH_API_KEY;
    delete process.env.DEEPSEEK_SEARCH_API_URL;
  });

  describe('query', () => {
    it('should return mapped results for a successful query', async () => {
      const mockResults = [
        {
          authority: 3,
          content: 'Full markdown content',
          date: '2026-06-01T00:00:00+00:00',
          rerank_score: 2.5,
          site_icon: 'https://example.com/favicon.ico',
          site_name: 'Example',
          snippet: 'Short snippet',
          summary: 'Long summary',
          title: 'Example Title',
          url: 'https://example.com/page',
        },
        {
          authority: 1,
          content: '',
          date: null,
          rerank_score: 1.2,
          site_icon: null,
          site_name: null,
          snippet: 'Only snippet',
          summary: 'Summary text',
          title: 'Second Title',
          url: 'https://another.com/article',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeDeepSeekResponse(mockResults)));

      const result = await impl.query('deepseek test');

      expect(result.query).toBe('deepseek test');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        category: 'general',
        content: 'Long summary',
        engines: ['deepseek'],
        parsedUrl: 'example.com',
        publishedDate: '2026-06-01T00:00:00+00:00',
        score: 2.5,
        title: 'Example Title',
        url: 'https://example.com/page',
      });
      // Second result uses summary text, date is null so publishedDate is undefined
      expect(result.results[1]).toMatchObject({
        content: 'Summary text',
        engines: ['deepseek'],
        parsedUrl: 'another.com',
        score: 1.2,
        title: 'Second Title',
        url: 'https://another.com/article',
      });
      expect(result.results[1].publishedDate).toBeUndefined();

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.deepseek.com/v1/tools/search');
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer test-deepseek-search-key',
      );
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody).toMatchObject({
        count: 10,
        need_content: false,
        query: 'deepseek test',
      });
    });

    it('should support custom DEEPSEEK_SEARCH_API_URL', async () => {
      process.env.DEEPSEEK_SEARCH_API_URL = 'https://custom.deepseek.proxy';
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeDeepSeekResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://custom.deepseek.proxy/v1/tools/search');
    });

    it('should append after: date syntax when searchTimeRange is specified', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeDeepSeekResponse([])));

      await impl.query('artificial intelligence', { searchTimeRange: 'week' });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.query).toMatch(/^artificial intelligence after:\d{4}-\d{2}-\d{2}$/);
    });

    it('should not append after: if query already contains after:', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeDeepSeekResponse([])));

      await impl.query('artificial intelligence after:2025-01-01', { searchTimeRange: 'week' });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.query).toBe('artificial intelligence after:2025-01-01');
    });

    it('should truncate query and preserve after: date syntax for long queries', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeDeepSeekResponse([])));

      const longQuery = 'artificial intelligence '.repeat(10); // > 200 chars
      await impl.query(longQuery, { searchTimeRange: 'week' });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.query).toMatch(/after:\d{4}-\d{2}-\d{2}$/);
      expect(parsedBody.query.length).toBeLessThanOrEqual(128);
    });

    it('should truncate query even when searchTimeRange is unknown or unsupported', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeDeepSeekResponse([])));

      const longQuery = 'a'.repeat(200);
      await impl.query(longQuery, { searchTimeRange: '1d' });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.query).toHaveLength(128);
    });

    it('should truncate query if exceeding 128 characters', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeDeepSeekResponse([])));

      const longQuery = 'a'.repeat(200);
      await impl.query(longQuery);

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.query).toHaveLength(128);
    });

    it('should throw SERVICE_UNAVAILABLE on network error', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      await expect(impl.query('test')).rejects.toThrow(
        'Failed to connect to DeepSeek search service.',
      );
    });

    it('should throw SERVICE_UNAVAILABLE on non-200 response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse({ error: { message: 'Invalid API key' } }, false, 401, 'Unauthorized'),
      );

      await expect(impl.query('test')).rejects.toThrow(/DeepSeek search request failed/);
    });

    it('should throw INTERNAL_SERVER_ERROR when JSON parsing fails', async () => {
      const mockRes = {
        json: vi.fn().mockRejectedValueOnce(new Error('Invalid JSON')),
        ok: true,
        status: 200,
        statusText: 'OK',
      } as unknown as Response;
      vi.mocked(fetch).mockResolvedValueOnce(mockRes);

      await expect(impl.query('test')).rejects.toThrow('Failed to parse DeepSeek response.');
    });
  });
});
