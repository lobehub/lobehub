import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../../utils/errorType';
import * as withTimeoutModule from '../../utils/withTimeout';
import { search1api } from '../search1api';

describe('search1api crawler', () => {
  // Mock fetch function
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  // Original env
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    originalEnv = { ...process.env };
    process.env.SEARCH1API_API_KEY = 'test-api-key';

    // Mock withTimeout to directly return the promise
    vi.spyOn(withTimeoutModule, 'withTimeout').mockImplementation((promise) => promise);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw NetworkConnectionError when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));

    await expect(search1api('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should throw TimeoutError when request times out', async () => {
    // Restore original withTimeout implementation for this test
    vi.spyOn(withTimeoutModule, 'withTimeout').mockRestore();

    // Mock withTimeout to throw TimeoutError
    vi.spyOn(withTimeoutModule, 'withTimeout').mockImplementation(() => {
      throw new TimeoutError('Request timeout after 10000ms');
    });

    await expect(search1api('https://example.com', { filterOptions: {} })).rejects.toThrow(
      TimeoutError,
    );
  });

  it('should throw PageNotFoundError when status is 404', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(search1api('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw error for other failed responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(search1api('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Search1API request failed with status 500: Internal Server Error',
    );
  });

  it('should return undefined when content is too short', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          crawlParameters: { url: 'https://example.com' },
          results: {
            title: 'Test Title',
            link: 'https://example.com',
            content: 'Short', // Less than 100 characters
          },
        }),
    });

    const result = await search1api('https://example.com', { filterOptions: {} });
    expect(result).toBeUndefined();
  });

  it('should return crawl result on successful fetch', async () => {
    const mockContent = 'This is a test content that is longer than 100 characters. '.repeat(3);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          crawlParameters: { url: 'https://example.com' },
          results: {
            title: 'Test Title',
            link: 'https://example.com',
            content: mockContent,
          },
        }),
    });

    const result = await search1api('https://example.com', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalledWith('https://api.search1api.com/crawl', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com',
      }),
    });

    expect(result).toEqual({
      content: mockContent,
      contentType: 'text',
      title: 'Test Title',
      description: 'Test Title',
      length: mockContent.length,
      siteName: 'example.com',
      url: 'https://example.com',
    });
  });

  it('should handle JSON parse errors', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    const result = await search1api('https://example.com', { filterOptions: {} });
    expect(result).toBeUndefined();
  });
});
