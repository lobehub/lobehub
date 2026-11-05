import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import { NetworkConnectionError, PageNotFoundError } from '../../utils/errorType';
import { withTimeout } from '../../utils/withTimeout';
import { deepseek } from '../deepseek';

vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 10_000,
  withTimeout: vi.fn((fn: (signal: AbortSignal) => Promise<Response>) =>
    fn(new AbortController().signal),
  ),
}));

const markdown = '# Example\n\nThis is a test markdown content with enough length to pass. '.repeat(
  3,
);

describe('deepseek crawler', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    delete process.env.DEEPSEEK_SEARCH_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch the page with the search API key', async () => {
    process.env.DEEPSEEK_SEARCH_API_KEY = 'search-key';
    process.env.DEEPSEEK_API_KEY = 'model-key';
    fetchMock.mockResolvedValue(createMockResponse({ content: markdown, title: 'Example' }));

    const result = await deepseek('https://example.com/post', { filterOptions: {} });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/tools/fetch',
      expect.objectContaining({
        body: JSON.stringify({ url: 'https://example.com/post' }),
        headers: { 'Authorization': 'Bearer search-key', 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(withTimeout).toHaveBeenCalledWith(expect.any(Function), 20_000);
    expect(result).toEqual({
      content: markdown,
      contentType: 'text',
      length: markdown.length,
      siteName: 'example.com',
      title: 'Example',
      url: 'https://example.com/post',
    });
  });

  it('should fall back to the DeepSeek model provider key', async () => {
    process.env.DEEPSEEK_API_KEY = 'model-key';
    fetchMock.mockResolvedValue(createMockResponse({ content: markdown, title: 'Example' }));

    await deepseek('https://example.com', { filterOptions: {} });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer model-key');
  });

  it('should undo the backslash escapes DeepSeek adds to the page text', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse({
        content: `\\# Search \\/ Fetch API\n\nPrice\\: 5 CNY \\(per 1\\,000 requests\\)\\. Path C\\:\\\\tmp\\. ${'x'.repeat(100)}`,
        title: 'Search \\/ Fetch',
      }),
    );

    const result = await deepseek('https://example.com', { filterOptions: {} });

    expect(result?.title).toBe('Search / Fetch');
    expect(result?.content).toBe(
      `# Search / Fetch API\n\nPrice: 5 CNY (per 1,000 requests). Path C:\\tmp. ${'x'.repeat(100)}`,
    );
  });

  it('should return undefined for short content', async () => {
    fetchMock.mockResolvedValue(createMockResponse({ content: 'too short', title: '' }));

    await expect(deepseek('https://example.com', { filterOptions: {} })).resolves.toBeUndefined();
  });

  it('should throw PageNotFoundError when DeepSeek cannot fetch usable content', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        { error: { message: 'failed to fetch URL', type: 'not_found_error' } },
        { ok: false, status: 404, statusText: 'Not Found' },
      ),
    );

    await expect(deepseek('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should include the DeepSeek error body for other HTTP errors', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        { error: { message: 'Insufficient Balance', type: 'invalid_request_error' } },
        { ok: false, status: 402, statusText: 'Payment Required' },
      ),
    );

    await expect(deepseek('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'DeepSeek request failed with status 402: Payment Required. Response: {"error":{"message":"Insufficient Balance"',
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(deepseek('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });
});
