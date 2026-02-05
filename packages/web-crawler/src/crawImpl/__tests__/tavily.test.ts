import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../../utils/errorType';
import { tavily } from '../tavily';

// Mock dependencies
vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 30000,
  withTimeout: vi.fn(),
}));

describe('tavily crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_EXTRACT_DEPTH;
  });

  it('should successfully crawl content with API key', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 1.5,
        results: [
          {
            url: 'https://example.com',
            raw_content:
              'This is a test raw content with sufficient length to pass validation. '.repeat(3),
            images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await tavily('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: 'This is a test raw content with sufficient length to pass validation. '.repeat(3),
      contentType: 'text',
      length: 'This is a test raw content with sufficient length to pass validation. '.repeat(3)
        .length,
      siteName: 'example.com',
      title: 'example.com',
      url: 'https://example.com',
    });

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 30000);
  });

  it('should use custom extract depth when provided', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';
    process.env.TAVILY_EXTRACT_DEPTH = 'advanced';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 2.1,
        results: [
          {
            url: 'https://example.com',
            raw_content: 'Advanced extraction content with more details. '.repeat(5),
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await tavily('https://example.com', { filterOptions: {} });

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 30000);
  });

  it('should handle missing API key', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 1.2,
        results: [
          {
            url: 'https://example.com',
            raw_content: 'Test content with sufficient length. '.repeat(5),
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await tavily('https://example.com', { filterOptions: {} });

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 30000);
  });

  it('should return undefined when no results are returned', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 0.8,
        results: [],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await tavily('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Tavily API returned no results for URL:',
      'https://example.com',
    );

    consoleSpy.mockRestore();
  });

  it('should return undefined for short content', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 1.1,
        results: [
          {
            url: 'https://example.com',
            raw_content: 'Short', // Content too short
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await tavily('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should return undefined when raw_content is missing', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 1,
        results: [
          {
            url: 'https://example.com',
            // raw_content is missing
            images: ['https://example.com/image.jpg'],
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await tavily('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should throw PageNotFoundError for 404 status', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(tavily('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw error for other HTTP errors', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(tavily('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Tavily request failed with status 500: Internal Server Error',
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(new Error('fetch failed'));

    await expect(tavily('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should throw TimeoutError when request times out', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const timeoutError = new TimeoutError('Request timeout');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(timeoutError);

    await expect(tavily('https://example.com', { filterOptions: {} })).rejects.toThrow(
      TimeoutError,
    );
  });

  it('should rethrow unknown errors', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const unknownError = new Error('Unknown error');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(unknownError);

    await expect(tavily('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Unknown error',
    );
  });

  it('should return undefined when JSON parsing fails', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await tavily('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should use result URL when available', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 1.3,
        results: [
          {
            url: 'https://redirected.example.com',
            raw_content: 'Test content with sufficient length. '.repeat(5),
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await tavily('https://example.com', { filterOptions: {} });

    expect(result?.url).toBe('https://redirected.example.com');
  });

  it('should fallback to original URL when result URL is missing', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 1.4,
        results: [
          {
            raw_content: 'Test content with sufficient length. '.repeat(5),
            // url is missing
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await tavily('https://example.com', { filterOptions: {} });

    expect(result?.url).toBe('https://example.com');
  });

  it('should handle failed results in response', async () => {
    process.env.TAVILY_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        base_url: 'https://api.tavily.com',
        response_time: 1.6,
        results: [],
        failed_results: [
          {
            url: 'https://example.com',
            error: 'Page not accessible',
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await tavily('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Tavily API returned no results for URL:',
      'https://example.com',
    );

    consoleSpy.mockRestore();
  });
});
