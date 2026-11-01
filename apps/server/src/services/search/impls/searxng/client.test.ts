// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearXNGClient } from './client';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SearXNGClient', () => {
  let client: SearXNGClient;

  beforeEach(() => {
    client = new SearXNGClient('https://searxng.example.com');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return results on successful response', async () => {
    const mockResponse = {
      answers: [],
      corrections: [],
      infoboxes: [],
      number_of_results: 1,
      query: 'test',
      results: [{ title: 'Test', url: 'https://example.com' }],
      suggestions: [],
      unresponsive_engines: [],
    };

    mockFetch.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
      ok: true,
    });

    const result = await client.search('test');
    expect(result).toEqual(mockResponse);
  });

  it('should return empty response when SearXNG 500 body contains "empty results"', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('SearxNG returned empty results'),
    });

    const result = await client.search('杭州天气');

    expect(result).toEqual({
      answers: [],
      corrections: [],
      infoboxes: [],
      number_of_results: 0,
      query: '杭州天气',
      results: [],
      suggestions: [],
      unresponsive_engines: [],
    });
  });

  it('should return empty response when body contains "Empty Results" (case insensitive)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () =>
        Promise.resolve('{"error":"Search failed","message":"SearxNG returned Empty Results"}'),
    });

    const result = await client.search('test query');

    expect(result.results).toEqual([]);
    expect(result.number_of_results).toBe(0);
  });

  it('should throw error for non-empty-results 500 responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('something went wrong'),
    });

    await expect(client.search('test')).rejects.toThrow(
      'Failed to search: 500 Internal Server Error - something went wrong',
    );
  });

  it('should include response body in error message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: () => Promise.resolve('upstream timeout'),
    });

    await expect(client.search('test')).rejects.toThrow(
      'Failed to search: 502 Bad Gateway - upstream timeout',
    );
  });

  it('should handle text() failure gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.reject(new Error('read failed')),
    });

    await expect(client.search('test')).rejects.toThrow(
      'Failed to search: 500 Internal Server Error',
    );
  });
});
