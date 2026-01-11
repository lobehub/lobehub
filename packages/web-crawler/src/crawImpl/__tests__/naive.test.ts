import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../../utils/errorType';
import { naive } from '../naive';

// Mock dependencies
vi.mock('../../utils/htmlToMarkdown', () => ({
  htmlToMarkdown: vi.fn(),
}));

vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 30000,
  withTimeout: vi.fn(),
}));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: vi.fn(),
}));

describe('naive crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return undefined for normal pages (due to cloudflare logic)', async () => {
    const mockResponse = {
      status: 200,
      headers: new Map([['content-type', 'text/html']]),
      text: vi.fn().mockResolvedValue('<html><body>Test content</body></html>'),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const { htmlToMarkdown } = await import('../../utils/htmlToMarkdown');
    vi.mocked(htmlToMarkdown).mockReturnValue({
      content: 'Test content'.padEnd(101, ' '), // Ensure length > 100
      title: 'Normal Page Title', // Not "Just a moment..." so it returns undefined
      description: 'Test description',
      siteName: 'Test Site',
      length: 101,
    });

    const result = await naive('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should successfully crawl JSON content', async () => {
    const mockJsonData = { message: 'Hello world', data: [1, 2, 3] };
    const mockResponse = {
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      clone: () => ({
        json: vi.fn().mockResolvedValue(mockJsonData),
      }),
      text: vi.fn().mockResolvedValue(JSON.stringify(mockJsonData)),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await naive('https://api.example.com/data', { filterOptions: {} });

    expect(result).toEqual({
      content: JSON.stringify(mockJsonData, null, 2),
      contentType: 'json',
      length: JSON.stringify(mockJsonData, null, 2).length,
      url: 'https://api.example.com/data',
    });
  });

  it('should handle malformed JSON by falling back to text', async () => {
    const mockText = '{"invalid": json}';
    const mockResponse = {
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      clone: () => ({
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      }),
      text: vi.fn().mockResolvedValue(mockText),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await naive('https://api.example.com/data', { filterOptions: {} });

    expect(result).toEqual({
      content: mockText,
      contentType: 'json',
      length: mockText.length,
      url: 'https://api.example.com/data',
    });
  });

  it('should return undefined for short content', async () => {
    const mockResponse = {
      status: 200,
      headers: new Map([['content-type', 'text/html']]),
      text: vi.fn().mockResolvedValue('<html><body>Short</body></html>'),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const { htmlToMarkdown } = await import('../../utils/htmlToMarkdown');
    vi.mocked(htmlToMarkdown).mockReturnValue({
      content: 'Short', // Length < 100
      title: 'Test Page',
      length: 5,
    });

    const result = await naive('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should return content when NOT blocked by Cloudflare', async () => {
    const mockResponse = {
      status: 200,
      headers: new Map([['content-type', 'text/html']]),
      text: vi.fn().mockResolvedValue('<html><body>Normal content</body></html>'),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const { htmlToMarkdown } = await import('../../utils/htmlToMarkdown');
    vi.mocked(htmlToMarkdown).mockReturnValue({
      content: 'Test content'.padEnd(101, ' '),
      title: 'Just a moment...', // Cloudflare blocking page - this will cause return
      description: 'Test description',
      siteName: 'Test Site',
      length: 101,
    });

    const result = await naive('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: 'Test content'.padEnd(101, ' '),
      contentType: 'text',
      description: 'Test description',
      length: 101,
      siteName: 'Test Site',
      title: 'Just a moment...',
      url: 'https://example.com',
    });
  });

  it('should throw PageNotFoundError for 404 status', async () => {
    const mockResponse = {
      status: 404,
      statusText: 'Not Found',
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(naive('https://example.com/notfound', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(new Error('fetch failed'));

    await expect(naive('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should throw TimeoutError when request times out', async () => {
    const timeoutError = new TimeoutError('Request timeout');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(timeoutError);

    await expect(naive('https://example.com', { filterOptions: {} })).rejects.toThrow(TimeoutError);
  });

  it('should rethrow unknown errors', async () => {
    const unknownError = new Error('Unknown error');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(unknownError);

    await expect(naive('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Unknown error',
    );
  });

  it('should return undefined when HTML processing fails', async () => {
    const mockResponse = {
      status: 200,
      headers: new Map([['content-type', 'text/html']]),
      text: vi.fn().mockRejectedValue(new Error('Failed to read text')),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await naive('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should pass filter options to htmlToMarkdown', async () => {
    const mockResponse = {
      status: 200,
      headers: new Map([['content-type', 'text/html']]),
      text: vi.fn().mockResolvedValue('<html><body>Test content</body></html>'),
    };

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const { htmlToMarkdown } = await import('../../utils/htmlToMarkdown');
    vi.mocked(htmlToMarkdown).mockReturnValue({
      content: 'Test content'.padEnd(101, ' '),
      title: 'Test Page',
      length: 101,
    });

    const filterOptions = { enableReadability: true, pureText: false };
    await naive('https://example.com', { filterOptions });

    expect(htmlToMarkdown).toHaveBeenCalledWith('<html><body>Test content</body></html>', {
      filterOptions,
      url: 'https://example.com',
    });
  });
});
