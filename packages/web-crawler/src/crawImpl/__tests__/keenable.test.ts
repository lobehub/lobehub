import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import { HTTPStatusError, NetworkConnectionError, PageNotFoundError } from '../../utils/errorType';
import { keenable } from '../keenable';

vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 10_000,
  withTimeout: vi.fn((fn: (signal: AbortSignal) => Promise<Response>) =>
    fn(new AbortController().signal),
  ),
}));

const markdown = '# Example\n\nThis is a test markdown content with enough length to pass. '.repeat(
  3,
);

describe('keenable crawler', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    delete process.env.KEENABLE_API_KEY;
    delete process.env.KEENABLE_API_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KEENABLE_API_KEY;
    delete process.env.KEENABLE_API_URL;
  });

  it('should use the keyless public endpoint when no API key is set', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse({ content: markdown, title: 'Example', url: 'https://example.com/post' }),
    );

    const result = await keenable('https://example.com/post?a=1&b=2', { filterOptions: {} });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.keenable.ai/v1/fetch/public?url=https%3A%2F%2Fexample.com%2Fpost%3Fa%3D1%26b%3D2',
      expect.objectContaining({
        headers: { 'Accept': 'application/json', 'X-Keenable-Title': 'LobeHub' },
        method: 'GET',
      }),
    );
    expect(result).toEqual({
      content: markdown,
      contentType: 'text',
      length: markdown.length,
      siteName: 'example.com',
      title: 'Example',
      url: 'https://example.com/post',
    });
  });

  it('should use the keyed endpoint and send the API key when set', async () => {
    process.env.KEENABLE_API_KEY = 'test-key';
    process.env.KEENABLE_API_URL = 'https://keenable.internal/';
    fetchMock.mockResolvedValue(createMockResponse({ content: markdown, title: 'Example' }));

    const result = await keenable('https://example.com', { filterOptions: {} });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://keenable.internal/v1/fetch?url=https%3A%2F%2Fexample.com',
      expect.objectContaining({
        headers: { 'Accept': 'application/json', 'X-API-Key': 'test-key' },
      }),
    );
    expect(result?.url).toBe('https://example.com');
  });

  it('should return undefined for short content', async () => {
    fetchMock.mockResolvedValue(createMockResponse({ content: 'too short', title: '' }));

    await expect(keenable('https://example.com', { filterOptions: {} })).resolves.toBeUndefined();
  });

  it('should map a 404 to PageNotFoundError', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        { error: 'Not found' },
        { ok: false, status: 404, statusText: 'Not Found' },
      ),
    );

    await expect(keenable('https://example.com/missing', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw HTTPStatusError with the status for other failures', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        { error: 'Rate limited' },
        { ok: false, status: 429, statusText: 'Too Many Requests' },
      ),
    );

    const error = await keenable('https://example.com', { filterOptions: {} }).catch((e) => e);

    expect(error).toBeInstanceOf(HTTPStatusError);
    expect(error.status).toBe(429);
    expect(error.message).toContain('Keenable request failed with status 429');
  });

  it('should translate network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(keenable('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });
});
