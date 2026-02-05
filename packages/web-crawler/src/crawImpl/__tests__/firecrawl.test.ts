import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../../utils/errorType';
import { firecrawl } from '../firecrawl';

// Mock dependencies
vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 30000,
  withTimeout: vi.fn(),
}));

describe('firecrawl crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_URL;
  });

  it('should successfully crawl content with API key', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          markdown:
            'This is a test markdown content with enough length to pass validation. '.repeat(3),
          metadata: {
            title: 'Test Article',
            description: 'Test description',
            sourceURL: 'https://example.com',
            statusCode: 200,
            language: 'en',
            keywords: 'test',
            robots: 'index',
          },
        },
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: 'This is a test markdown content with enough length to pass validation. '.repeat(3),
      contentType: 'text',
      description: 'Test description',
      length: 'This is a test markdown content with enough length to pass validation. '.repeat(3)
        .length,
      siteName: 'example.com',
      title: 'Test Article',
      url: 'https://example.com',
    });

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 30000);
  });

  it('should handle missing API key', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          markdown: 'Test content with sufficient length. '.repeat(5),
          metadata: {
            title: 'Test',
            description: 'Test',
            sourceURL: 'https://example.com',
            statusCode: 200,
            language: 'en',
            keywords: 'test',
            robots: 'index',
          },
        },
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await firecrawl('https://example.com', { filterOptions: {} });

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 30000);
  });

  it('should return undefined for short content', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          markdown: 'Short', // Content too short
          metadata: {
            title: 'Test',
            description: 'Test',
            sourceURL: 'https://example.com',
            statusCode: 200,
            language: 'en',
            keywords: 'test',
            robots: 'index',
          },
        },
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should return undefined when markdown is missing', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          // markdown is missing
          metadata: {
            title: 'Test',
            description: 'Test',
            sourceURL: 'https://example.com',
            statusCode: 200,
            language: 'en',
            keywords: 'test',
            robots: 'index',
          },
        },
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should throw PageNotFoundError for 404 status', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw error for other HTTP errors', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Firecrawl request failed with status 500: Internal Server Error',
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(new Error('fetch failed'));

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should throw TimeoutError when request times out', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const timeoutError = new TimeoutError('Request timeout');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(timeoutError);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      TimeoutError,
    );
  });

  it('should rethrow unknown errors', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const unknownError = new Error('Unknown error');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(unknownError);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Unknown error',
    );
  });

  it('should return undefined when JSON parsing fails', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should handle metadata with all optional fields', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          markdown: 'Complete test content with all metadata fields provided. '.repeat(3),
          metadata: {
            title: 'Complete Test Article',
            description: 'Complete test description',
            keywords: 'test,complete,article',
            language: 'en',
            ogDescription: 'OG description',
            ogImage: 'https://example.com/image.jpg',
            ogLocaleAlternate: ['en-US', 'fr-FR'],
            ogSiteName: 'Example Site',
            ogTitle: 'OG Title',
            ogUrl: 'https://example.com/og',
            robots: 'index,follow',
            statusCode: 200,
            sourceURL: 'https://example.com',
          },
        },
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: 'Complete test content with all metadata fields provided. '.repeat(3),
      contentType: 'text',
      description: 'Complete test description',
      length: 'Complete test content with all metadata fields provided. '.repeat(3).length,
      siteName: 'example.com',
      title: 'Complete Test Article',
      url: 'https://example.com',
    });
  });
});
