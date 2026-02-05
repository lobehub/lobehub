import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jina } from '../jina';

describe('jina crawler', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should crawl url successfully', async () => {
    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          code: 200,
          data: {
            content: 'test content',
            description: 'test description',
            siteName: 'test site',
            title: 'test title',
          },
        }),
    };

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
    });

    expect(result).toEqual({
      content: 'test content',
      contentType: 'text',
      description: 'test description',
      length: 12,
      siteName: 'test site',
      title: 'test title',
      url: 'https://example.com',
    });
  });

  it('should use JINA_READER_API_KEY from env if apiKey not provided', async () => {
    process.env.JINA_READER_API_KEY = 'env-reader-key';

    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          code: 200,
          data: {
            content: 'test content',
          },
        }),
    };

    mockFetch.mockResolvedValue(mockResponse);

    await jina('https://example.com', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalledWith('https://r.jina.ai/https://example.com', {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer env-reader-key',
        'x-send-from': 'LobeChat Community',
      },
    });

    delete process.env.JINA_READER_API_KEY;
  });

  it('should use JINA_API_KEY from env if apiKey and JINA_READER_API_KEY not provided', async () => {
    process.env.JINA_API_KEY = 'env-key';

    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          code: 200,
          data: {
            content: 'test content',
          },
        }),
    };

    mockFetch.mockResolvedValue(mockResponse);

    await jina('https://example.com', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalledWith('https://r.jina.ai/https://example.com', {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer env-key',
        'x-send-from': 'LobeChat Community',
      },
    });

    delete process.env.JINA_API_KEY;
  });

  it('should send empty Authorization header if no api key provided', async () => {
    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          code: 200,
          data: {
            content: 'test content',
          },
        }),
    };

    mockFetch.mockResolvedValue(mockResponse);

    await jina('https://example.com', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalledWith('https://r.jina.ai/https://example.com', {
      headers: {
        'Accept': 'application/json',
        'Authorization': '',
        'x-send-from': 'LobeChat Community',
      },
    });
  });

  it('should return undefined if response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const result = await jina('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should return undefined if response code is not 200', async () => {
    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          code: 400,
          message: 'Bad Request',
        }),
    };

    mockFetch.mockResolvedValue(mockResponse);

    const result = await jina('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should return undefined if fetch throws error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await jina('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });
});
