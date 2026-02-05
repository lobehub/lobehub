import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../../utils/errorType';
import { exa } from '../exa';

// Mock dependencies
vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 30000,
  withTimeout: vi.fn(),
}));

describe('exa crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EXA_API_KEY;
  });

  it('should successfully crawl content with API key', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestId: 'test-request-id',
        results: [
          {
            id: 'test-id',
            title: 'Test Article',
            url: 'https://example.com',
            text: 'This is a test article with enough content to pass the length check. '.repeat(3),
            author: 'Test Author',
            publishedDate: '2023-01-01',
            summary: 'Test summary',
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await exa('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: 'This is a test article with enough content to pass the length check. '.repeat(3),
      contentType: 'text',
      length: 'This is a test article with enough content to pass the length check. '.repeat(3)
        .length,
      siteName: 'example.com',
      title: 'Test Article',
      url: 'https://example.com',
    });

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 30000);
  });

  it('should handle missing API key', async () => {
    // API key is undefined
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          {
            title: 'Test Article',
            url: 'https://example.com',
            text: 'Test content with sufficient length. '.repeat(5),
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await exa('https://example.com', { filterOptions: {} });

    // Check that fetch was called with empty API key header
    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 30000);
  });

  it('should return undefined when no results are returned', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestId: 'test-request-id',
        results: [],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await exa('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Exa API returned no results for URL:',
      'https://example.com',
    );

    consoleSpy.mockRestore();
  });

  it('should return undefined for short content', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          {
            title: 'Test Article',
            url: 'https://example.com',
            text: 'Short', // Content too short
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await exa('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should throw PageNotFoundError for 404 status', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(exa('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw error for other HTTP errors', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(exa('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Exa request failed with status 500: Internal Server Error',
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(new Error('fetch failed'));

    await expect(exa('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should throw TimeoutError when request times out', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const timeoutError = new TimeoutError('Request timeout');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(timeoutError);

    await expect(exa('https://example.com', { filterOptions: {} })).rejects.toThrow(TimeoutError);
  });

  it('should rethrow unknown errors', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const unknownError = new Error('Unknown error');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(unknownError);

    await expect(exa('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Unknown error',
    );
  });

  it('should return undefined when JSON parsing fails', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await exa('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should use result URL when available', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          {
            title: 'Test Article',
            url: 'https://redirected.example.com',
            text: 'Test content with sufficient length. '.repeat(5),
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await exa('https://example.com', { filterOptions: {} });

    expect(result?.url).toBe('https://redirected.example.com');
  });

  it('should fallback to original URL when result URL is missing', async () => {
    process.env.EXA_API_KEY = 'test-api-key';

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          {
            title: 'Test Article',
            text: 'Test content with sufficient length. '.repeat(5),
            // url is missing
          },
        ],
      }),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await exa('https://example.com', { filterOptions: {} });

    expect(result?.url).toBe('https://example.com');
  });
});
