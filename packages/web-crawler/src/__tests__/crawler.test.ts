import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Crawler } from '../crawler';

// Move mocks outside of test cases to avoid hoisting issues
vi.mock('../crawImpl', () => ({
  crawlImpls: {
    naive: vi.fn(),
    jina: vi.fn(),
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
});
