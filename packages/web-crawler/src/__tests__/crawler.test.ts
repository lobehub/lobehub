import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Crawler } from '../crawler';
import { HTTPStatusError, PageNotFoundError } from '../utils/errorType';

// Move mocks outside of test cases to avoid hoisting issues
vi.mock('../crawImpl', () => ({
  crawlImpls: {
    naive: vi.fn(),
    jina: vi.fn(),
    search1api: vi.fn(),
    browserless: vi.fn(),
  },
}));

vi.mock('../utils/appUrlRules', () => ({
  applyUrlRules: vi.fn().mockReturnValue({
    transformedUrl: 'https://example.com',
    filterOptions: {},
  }),
}));

describe('Crawler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset applyUrlRules to default (no impls override)
    const { applyUrlRules } = await import('../utils/appUrlRules');
    vi.mocked(applyUrlRules).mockReturnValue({
      transformedUrl: 'https://example.com',
      filterOptions: {},
    });
  });

  const crawler = new Crawler();

  it('should crawl successfully with default impls', async () => {
    const mockResult = {
      content: 'test content'.padEnd(101, ' '), // Ensure content length > 100
      contentType: 'text' as const,
      url: 'https://example.com',
    };

    const { crawlImpls } = await import('../crawImpl');
    vi.mocked(crawlImpls.naive).mockResolvedValue(mockResult);

    const result = await crawler.crawl({
      url: 'https://example.com',
    });

    expect(result).toEqual({
      crawler: 'naive',
      data: mockResult,
      originalUrl: 'https://example.com',
      transformedUrl: undefined,
    });
  });

  it('should use user provided impls', async () => {
    const mockResult = {
      content: 'test content'.padEnd(101, ' '), // Ensure content length > 100
      contentType: 'text' as const,
      url: 'https://example.com',
    };

    const { crawlImpls } = await import('../crawImpl');
    vi.mocked(crawlImpls.jina).mockResolvedValue(mockResult);

    const result = await crawler.crawl({
      impls: ['jina'],
      url: 'https://example.com',
    });

    expect(result).toEqual({
      crawler: 'jina',
      data: mockResult,
      originalUrl: 'https://example.com',
      transformedUrl: undefined,
    });
  });

  it('should handle crawl errors', async () => {
    const mockError = new Error('Crawl failed');
    mockError.name = 'CrawlError';

    const { crawlImpls } = await import('../crawImpl');
    vi.mocked(crawlImpls.naive).mockRejectedValue(mockError);
    vi.mocked(crawlImpls.jina).mockRejectedValue(mockError);
    vi.mocked(crawlImpls.browserless).mockRejectedValue(mockError);

    const result = await crawler.crawl({
      url: 'https://example.com',
    });

    expect(result).toEqual({
      crawler: 'browserless',
      data: {
        content: 'Fail to crawl the page. Error type: CrawlError, error message: Crawl failed',
        errorMessage: 'Crawl failed',
        errorType: 'CrawlError',
      },
      originalUrl: 'https://example.com',
      transformedUrl: undefined,
    });
  });

  it('should handle transformed urls', async () => {
    const mockResult = {
      content: 'test content'.padEnd(101, ' '), // Ensure content length > 100
      contentType: 'text' as const,
      url: 'https://transformed.example.com',
    };

    const { crawlImpls } = await import('../crawImpl');
    vi.mocked(crawlImpls.naive).mockResolvedValue(mockResult);

    const { applyUrlRules } = await import('../utils/appUrlRules');
    vi.mocked(applyUrlRules).mockReturnValue({
      transformedUrl: 'https://transformed.example.com',
      filterOptions: {},
    });

    const result = await crawler.crawl({
      url: 'https://example.com',
    });

    expect(result).toEqual({
      crawler: 'naive',
      data: mockResult,
      originalUrl: 'https://example.com',
      transformedUrl: 'https://transformed.example.com',
    });
  });

  it('should merge filter options correctly', async () => {
    const mockResult = {
      content: 'test content'.padEnd(101, ' '), // Ensure content length > 100
      contentType: 'text' as const,
      url: 'https://example.com',
    };

    const { crawlImpls } = await import('../crawImpl');
    const mockCrawlImpl = vi.mocked(crawlImpls.naive).mockResolvedValue(mockResult);

    const { applyUrlRules } = await import('../utils/appUrlRules');
    vi.mocked(applyUrlRules).mockReturnValue({
      transformedUrl: 'https://example.com',
      filterOptions: { pureText: true },
    });

    await crawler.crawl({
      url: 'https://example.com',
      filterOptions: { enableReadability: true },
    });

    expect(mockCrawlImpl).toHaveBeenCalledWith('https://example.com', {
      filterOptions: {
        pureText: true,
        enableReadability: true,
      },
    });
  });

  it('should use rule impls when provided', async () => {
    const mockResult = {
      content: 'test content'.padEnd(101, ' '), // Ensure content length > 100
      contentType: 'text' as const,
      url: 'https://example.com',
    };

    const { crawlImpls } = await import('../crawImpl');
    vi.mocked(crawlImpls.jina).mockResolvedValue(mockResult);

    const { applyUrlRules } = await import('../utils/appUrlRules');
    vi.mocked(applyUrlRules).mockReturnValue({
      transformedUrl: 'https://example.com',
      filterOptions: {},
      impls: ['jina'],
    });

    const result = await crawler.crawl({
      url: 'https://example.com',
    });

    expect(result).toEqual({
      crawler: 'jina',
      data: mockResult,
      originalUrl: 'https://example.com',
      transformedUrl: undefined,
    });
  });

  it('should fall back to configured impls when rule impls are not in user-configured impls', async () => {
    const mockResult = {
      content: 'test content'.padEnd(101, ' '),
      contentType: 'text' as const,
      url: 'https://example.com',
    };

    const crawlerWithNaiveOnly = new Crawler({ impls: ['naive'] });

    const { crawlImpls } = await import('../crawImpl');
    vi.mocked(crawlImpls.naive).mockResolvedValue(mockResult);

    const { applyUrlRules } = await import('../utils/appUrlRules');
    vi.mocked(applyUrlRules).mockReturnValue({
      transformedUrl: 'https://example.com',
      filterOptions: {},
      impls: ['jina'],
    });

    const result = await crawlerWithNaiveOnly.crawl({
      url: 'https://example.com',
    });

    expect(result).toEqual({
      crawler: 'naive',
      data: mockResult,
      originalUrl: 'https://example.com',
      transformedUrl: undefined,
    });
  });

  it('should skip results with content length <= 100', async () => {
    const mockResult = {
      content: 'short content', // Content length <= 100
      contentType: 'text' as const,
      url: 'https://example.com',
    };

    const { crawlImpls } = await import('../crawImpl');
    vi.mocked(crawlImpls.naive).mockResolvedValue(mockResult);
    vi.mocked(crawlImpls.jina).mockResolvedValue(mockResult);
    vi.mocked(crawlImpls.browserless).mockResolvedValue(mockResult);

    const result = await crawler.crawl({
      url: 'https://example.com',
    });

    expect(result).toEqual({
      crawler: 'browserless',
      data: {
        content:
          'Fail to crawl the page. Error type: EmptyCrawlResultError, error message: browserless returned empty or short content',
        errorMessage: 'browserless returned empty or short content',
        errorType: 'EmptyCrawlResultError',
      },
      originalUrl: 'https://example.com',
      transformedUrl: undefined,
    });
  });

  describe('preflight', () => {
    it('should reject an invalid url without calling any impl', async () => {
      const { crawlImpls } = await import('../crawImpl');

      const result = await crawler.crawl({ url: 'not a url at all' });

      expect(result.crawler).toBe('preflight');
      expect(result.data).toMatchObject({ errorType: 'InvalidUrlError', retryable: false });
      expect((result.data as any).content).toContain('Invalid URL');
      expect(crawlImpls.naive).not.toHaveBeenCalled();
      expect(crawlImpls.jina).not.toHaveBeenCalled();
    });

    it('should repair a bare domain by prepending https:// and report the transformed url', async () => {
      const mockResult = {
        content: 'test content'.padEnd(101, ' '),
        contentType: 'text' as const,
        url: 'https://example.com/docs',
      };

      const { crawlImpls } = await import('../crawImpl');
      vi.mocked(crawlImpls.naive).mockResolvedValue(mockResult);

      const { applyUrlRules } = await import('../utils/appUrlRules');
      vi.mocked(applyUrlRules).mockImplementation((url) => ({ transformedUrl: url }));

      const result = await crawler.crawl({ url: 'example.com/docs' });

      expect(applyUrlRules).toHaveBeenCalledWith('https://example.com/docs', expect.anything());
      expect(crawlImpls.naive).toHaveBeenCalledWith('https://example.com/docs', expect.anything());
      expect(result).toEqual({
        crawler: 'naive',
        data: mockResult,
        originalUrl: 'example.com/docs',
        transformedUrl: 'https://example.com/docs',
      });
    });

    it('should reject resource files (images / fonts / media) without calling any impl', async () => {
      const { crawlImpls } = await import('../crawImpl');

      for (const url of [
        'https://lobe.example.com:8443/app-icons/icon-512x512.png',
        'https://example.no/assets/logo.svg?v=3',
        'https://cdn.example.com/fonts/inter.woff2',
        'https://example.com/clip.mp4',
      ]) {
        const result = await crawler.crawl({ url });

        expect(result.crawler).toBe('preflight');
        expect(result.data).toMatchObject({
          errorType: 'UnsupportedContentError',
          retryable: false,
        });
      }

      expect(crawlImpls.naive).not.toHaveBeenCalled();
      expect(crawlImpls.jina).not.toHaveBeenCalled();
      expect(crawlImpls.search1api).not.toHaveBeenCalled();
    });
  });

  describe('dead links', () => {
    it('should stop trying other impls once a page is confirmed 404 and mark it non-retryable', async () => {
      const { crawlImpls } = await import('../crawImpl');
      vi.mocked(crawlImpls.jina).mockRejectedValue(new Error('jina failed'));
      vi.mocked(crawlImpls.naive).mockRejectedValue(new PageNotFoundError('Not Found', 404));

      const result = await crawler.crawl({ url: 'https://example.com/missing' });

      expect(crawlImpls.jina).toHaveBeenCalledTimes(1);
      expect(crawlImpls.naive).toHaveBeenCalledTimes(1);
      expect(crawlImpls.search1api).not.toHaveBeenCalled();
      expect(crawlImpls.browserless).not.toHaveBeenCalled();
      expect(result.crawler).toBe('naive');
      expect(result.data).toMatchObject({
        errorType: 'PageNotFoundError',
        errorMessage: 'Not Found',
        retryable: false,
      });
      expect((result.data as any).content).toContain('HTTP 404');
      expect((result.data as any).content).toContain('do not retry');
    });

    it('should treat 410 Gone the same way', async () => {
      const { crawlImpls } = await import('../crawImpl');
      vi.mocked(crawlImpls.jina).mockRejectedValue(new PageNotFoundError('Gone', 410));

      const result = await crawler.crawl({ url: 'https://example.com/removed' });

      expect(crawlImpls.naive).not.toHaveBeenCalled();
      expect((result.data as any).content).toContain('HTTP 410');
      expect(result.data).toMatchObject({ retryable: false });
    });
  });

  describe('retryable flag', () => {
    it('should leave transient failures retryable', async () => {
      const { crawlImpls } = await import('../crawImpl');
      const transient = new HTTPStatusError('Provider request failed with status 502', 502);
      vi.mocked(crawlImpls.naive).mockRejectedValue(transient);
      vi.mocked(crawlImpls.jina).mockRejectedValue(transient);
      vi.mocked(crawlImpls.search1api).mockRejectedValue(transient);
      vi.mocked(crawlImpls.browserless).mockRejectedValue(transient);

      const result = await crawler.crawl({ url: 'https://example.com' });

      expect(result.data).not.toHaveProperty('retryable');
      expect(result.data).toMatchObject({ errorType: 'HTTPStatusError' });
    });

    it('should mark a provider 4xx rejection (e.g. non-document content) non-retryable', async () => {
      const { crawlImpls } = await import('../crawImpl');
      const rejected = new HTTPStatusError(
        'Search1API request failed with status 400: Bad Request. Response: URL points to non-document content (image/svg+xml)',
        400,
      );
      vi.mocked(crawlImpls.naive).mockRejectedValue(rejected);
      vi.mocked(crawlImpls.jina).mockRejectedValue(rejected);
      vi.mocked(crawlImpls.search1api).mockRejectedValue(rejected);
      vi.mocked(crawlImpls.browserless).mockRejectedValue(rejected);

      const result = await crawler.crawl({ url: 'https://example.com' });

      expect(result.data).toMatchObject({ errorType: 'HTTPStatusError', retryable: false });
    });
  });
});
