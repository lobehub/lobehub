import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import * as withTimeoutModule from '../../utils/withTimeout';
import { jina } from '../jina';

// Mock withTimeout to just call the factory function directly (bypassing real timeout)
vi.spyOn(withTimeoutModule, 'withTimeout').mockImplementation((fn) =>
  fn(new AbortController().signal),
);

describe('jina crawler', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    vi.resetAllMocks();
    // Re-apply the withTimeout spy after resetAllMocks
    vi.spyOn(withTimeoutModule, 'withTimeout').mockImplementation((fn) =>
      fn(new AbortController().signal),
    );
  });

  it('should crawl url successfully', async () => {
    const testContent =
      'This is a test content that is long enough to pass the minimum length validation check. '.repeat(
        2,
      );

    const mockResponse = createMockResponse(
      {
        code: 200,
        data: {
          content: testContent,
          description: 'test description',
          siteName: 'test site',
          title: 'test title',
        },
      },
      { ok: true },
    );

    mockFetch.mockResolvedValue(mockResponse);

    const result = await jina('https://example.com', {
      apiKey: 'test-key',
      filterOptions: {},
    });

    expect(mockFetch).toHaveBeenCalledWith('https://r.jina.ai/https://example.com', {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer test-key',
        'x-send-from': 'LobeChat Community',
      },
      signal: expect.any(AbortSignal),
    });

    expect(result).toEqual({
      content: testContent,
      contentType: 'text',
      description: 'test description',
      length: testContent.length,
      siteName: 'test site',
      title: 'test title',
      url: 'https://example.com',
    });
  });

  it('should use JINA_READER_API_KEY from env if apiKey not provided', async () => {
    process.env.JINA_READER_API_KEY = 'env-reader-key';

    const mockResponse = createMockResponse(
      {
        code: 200,
        data: {
          content: 'test content',
        },
      },
      { ok: true },
    );

    mockFetch.mockResolvedValue(mockResponse);

    await jina('https://example.com', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalledWith('https://r.jina.ai/https://example.com', {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer env-reader-key',
        'x-send-from': 'LobeChat Community',
      },
      signal: expect.any(AbortSignal),
    });

    delete process.env.JINA_READER_API_KEY;
  });

  it('should use JINA_API_KEY from env if apiKey and JINA_READER_API_KEY not provided', async () => {
    process.env.JINA_API_KEY = 'env-key';

    const mockResponse = createMockResponse(
      {
        code: 200,
        data: {
          content: 'test content',
        },
      },
      { ok: true },
    );

    mockFetch.mockResolvedValue(mockResponse);

    await jina('https://example.com', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalledWith('https://r.jina.ai/https://example.com', {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer env-key',
        'x-send-from': 'LobeChat Community',
      },
      signal: expect.any(AbortSignal),
    });

    delete process.env.JINA_API_KEY;
  });

  it('should send empty Authorization header if no api key provided', async () => {
    const mockResponse = createMockResponse(
      {
        code: 200,
        data: {
          content: 'test content',
        },
      },
      { ok: true },
    );

    mockFetch.mockResolvedValue(mockResponse);

    await jina('https://example.com', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalledWith('https://r.jina.ai/https://example.com', {
      headers: {
        'Accept': 'application/json',
        'Authorization': '',
        'x-send-from': 'LobeChat Community',
      },
      signal: expect.any(AbortSignal),
    });
  });

  it('should return undefined if response is not ok', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse(null, { ok: false, status: 500, statusText: 'Internal Server Error' }),
    );

    const result = await jina('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should return undefined if response code is not 200', async () => {
    const mockResponse = createMockResponse(
      {
        code: 400,
        message: 'Bad Request',
      },
      { ok: true },
    );

    mockFetch.mockResolvedValue(mockResponse);

    const result = await jina('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should throw error if fetch throws non-fetch-failed error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(jina('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Network error',
    );
  });
});
