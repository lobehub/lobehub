// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirecrawlImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeFirecrawlResponse = (data: {
  images?: object[];
  news?: object[];
  web?: object[];
}) => ({
  data,
  success: true,
});

const getRequestBody = () =>
  JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);

describe('FirecrawlImpl', () => {
  let impl: FirecrawlImpl;

  beforeEach(() => {
    impl = new FirecrawlImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.FIRECRAWL_API_KEY = 'test-firecrawl-api-key';
    delete process.env.FIRECRAWL_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_URL;
  });

  describe('query', () => {
    it('should map web, news and image results', async () => {
      const response = makeFirecrawlResponse({
        images: [
          {
            imageUrl: 'https://example.com/pic.png',
            title: 'An image',
            url: 'https://example.com/gallery',
          },
        ],
        news: [
          {
            snippet: 'Breaking news content',
            title: 'News Title',
            url: 'https://news.example.com/story',
          },
        ],
        web: [
          {
            description: 'Web description',
            title: 'Web Title',
            url: 'https://example.com/page',
          },
        ],
      });

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(response));

      const result = await impl.query('test query');

      expect(result.query).toBe('test query');
      expect(result.resultNumbers).toBe(3);
      expect(result.results).toHaveLength(3);

      expect(result.results[0]).toMatchObject({
        category: 'general',
        content: 'Web description',
        engines: ['firecrawl'],
        parsedUrl: 'example.com',
        title: 'Web Title',
        url: 'https://example.com/page',
      });
      expect(result.results[1]).toMatchObject({
        category: 'news',
        content: 'Breaking news content',
        engines: ['firecrawl'],
        title: 'News Title',
        url: 'https://news.example.com/story',
      });
      expect(result.results[2]).toMatchObject({
        category: 'images',
        engines: ['firecrawl'],
        title: 'An image',
        // Images map their url to the imageUrl field
        url: 'https://example.com/pic.png',
      });
    });

    it('should return empty results when data groups are missing', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      const result = await impl.query('empty query');

      expect(result.resultNumbers).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should default to web and news sources when no categories are provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test');

      expect(getRequestBody().sources).toEqual([{ type: 'web' }, { type: 'news' }]);
    });

    it('should derive sources from searchCategories', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test', { searchCategories: ['news', 'images'] });

      expect(getRequestBody().sources).toEqual([{ type: 'news' }, { type: 'images' }]);
    });

    it('should map the general category to the web source', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test', { searchCategories: ['general'] });

      expect(getRequestBody().sources).toEqual([{ type: 'web' }]);
    });

    it('should fall back to default sources for unsupported categories', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test', { searchCategories: ['science', 'videos'] });

      expect(getRequestBody().sources).toEqual([{ type: 'web' }, { type: 'news' }]);
    });

    it('should map searchTimeRange to the tbs parameter', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test', { searchTimeRange: 'week' });

      expect(getRequestBody().tbs).toBe('qdr:w');
    });

    it('should not set tbs for anytime', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test', { searchTimeRange: 'anytime' });

      expect(getRequestBody().tbs).toBeUndefined();
    });

    it('should include Bearer token in authorization header', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test');

      const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect((options.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer test-firecrawl-api-key',
      );
    });

    it('should use empty string in authorization header when API key not set', async () => {
      delete process.env.FIRECRAWL_API_KEY;

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test');

      const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect((options.headers as Record<string, string>)['Authorization']).toBe('');
    });

    it('should target the search endpoint of the configured base url', async () => {
      process.env.FIRECRAWL_URL = 'https://firecrawl.example.com/v2';

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      await impl.query('test');

      expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://firecrawl.example.com/v2/search');
    });

    it('should throw SERVICE_UNAVAILABLE when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Firecrawl.',
      });
    });

    it('should throw SERVICE_UNAVAILABLE when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({ error: 'Too Many Requests' }, false, 429, 'Too Many Requests'),
      );

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Firecrawl request failed: Too Many Requests',
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
        message: 'Failed to parse Firecrawl response.',
      });
    });

    it('should include costTime in the response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeFirecrawlResponse({})));

      const result = await impl.query('test');

      expect(typeof result.costTime).toBe('number');
      expect(result.costTime).toBeGreaterThanOrEqual(0);
    });
  });
});
