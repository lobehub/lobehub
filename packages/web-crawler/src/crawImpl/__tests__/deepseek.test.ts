import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../../utils/errorType';
import { deepseek } from '../deepseek';

vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 30000,
  withTimeout: vi.fn(),
}));

describe('deepseek crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEEPSEEK_SEARCH_API_KEY;
    delete process.env.DEEPSEEK_SEARCH_API_URL;
  });

  it('should successfully crawl content with API key', async () => {
    process.env.DEEPSEEK_SEARCH_API_KEY = 'test-deepseek-key';

    const mockResponse = createMockResponse({
      content: '# Article Title\n\nThis is the markdown body of the crawled page.',
      title: 'Article Title',
    });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await deepseek('https://example.com/article', { filterOptions: {} });

    expect(result).toEqual({
      content: '# Article Title\n\nThis is the markdown body of the crawled page.',
      contentType: 'text',
      length: '# Article Title\n\nThis is the markdown body of the crawled page.'.length,
      siteName: 'example.com',
      title: 'Article Title',
      url: 'https://example.com/article',
    });

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Function), 30000);
  });

  it('should support custom DEEPSEEK_SEARCH_API_URL and normalize trailing slashes', async () => {
    process.env.DEEPSEEK_SEARCH_API_KEY = 'test-deepseek-key';
    process.env.DEEPSEEK_SEARCH_API_URL = 'https://custom.deepseek.proxy/';

    const mockResponse = createMockResponse({
      content: 'Custom endpoint content',
      title: 'Custom Title',
    });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockImplementation(async (fn: any) => {
      return fn(new AbortController().signal);
    });

    const fetchSpy = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchSpy);

    const result = await deepseek('https://example.com', { filterOptions: {} });
    expect(result?.title).toBe('Custom Title');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://custom.deepseek.proxy/v1/tools/fetch',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    vi.unstubAllGlobals();
  });

  it('should return undefined when content is empty', async () => {
    process.env.DEEPSEEK_SEARCH_API_KEY = 'test-deepseek-key';

    const mockResponse = createMockResponse({
      content: '   ',
      title: 'Empty Article',
    });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await deepseek('https://example.com', { filterOptions: {} });
    expect(result).toBeUndefined();
  });

  it('should throw PageNotFoundError on 404 response', async () => {
    process.env.DEEPSEEK_SEARCH_API_KEY = 'test-deepseek-key';

    const mockResponse = createMockResponse(
      { error: { message: 'Page not found' } },
      { ok: false, status: 404, statusText: 'Not Found' },
    );

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(deepseek('https://example.com/404', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should handle timeout errors', async () => {
    process.env.DEEPSEEK_SEARCH_API_KEY = 'test-deepseek-key';

    const { withTimeout } = await import('../../utils/withTimeout');
    const timeoutError = new TimeoutError('Request timeout');
    vi.mocked(withTimeout).mockRejectedValue(timeoutError);

    await expect(deepseek('https://example.com', { filterOptions: {} })).rejects.toThrow(
      TimeoutError,
    );
  });

  it('should handle network connection errors', async () => {
    process.env.DEEPSEEK_SEARCH_API_KEY = 'test-deepseek-key';

    const { withTimeout } = await import('../../utils/withTimeout');
    const fetchError = new TypeError('fetch failed');
    vi.mocked(withTimeout).mockRejectedValue(fetchError);

    await expect(deepseek('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });
});
