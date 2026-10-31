import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../../utils/errorType';
import { outcrawl } from '../outcrawl';

// Mock dependencies
vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 30000,
  withTimeout: vi.fn(),
}));

const markdown = 'This is a test markdown content with enough length to pass validation. '.repeat(
  3,
);

describe('outcrawl crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.OUTCRAWL_API_KEY;
    delete process.env.OUTCRAWL_URL;
  });

  it('should successfully crawl content with API key', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({
      markdown,
      metadata: {
        description: 'Test description',
        language: 'en',
        title: 'Test Article',
      },
      statusCode: 200,
      url: 'https://example.com/',
      usage: { credits: '1' },
    });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await outcrawl('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: markdown,
      contentType: 'text',
      description: 'Test description',
      length: markdown.length,
      siteName: 'example.com',
      title: 'Test Article',
      url: 'https://example.com',
    });

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Function), 30000);
  });

  it('should POST to the scrape endpoint with bearer auth and markdown format', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({ markdown, metadata: {}, statusCode: 200 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockImplementation((fn) => fn(new AbortController().signal));

    await outcrawl('https://example.com', { filterOptions: {} });

    expect(fetchMock).toHaveBeenCalledWith('https://api.outcrawl.ai/v1/scrape', {
      body: JSON.stringify({ formats: ['markdown'], url: 'https://example.com' }),
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: expect.any(AbortSignal),
    });
  });

  it('should use OUTCRAWL_URL when set', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';
    process.env.OUTCRAWL_URL = 'https://outcrawl.internal/v1';

    const mockResponse = createMockResponse({ markdown, metadata: {}, statusCode: 200 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockImplementation((fn) => fn(new AbortController().signal));

    await outcrawl('https://example.com', { filterOptions: {} });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://outcrawl.internal/v1/scrape',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should return undefined for short content', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({
      markdown: 'Short',
      metadata: { title: 'Test' },
      statusCode: 200,
    });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await outcrawl('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should return undefined when markdown is missing', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({ metadata: { title: 'Test' }, statusCode: 200 });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    const result = await outcrawl('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should throw PageNotFoundError when the target page answers 404', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({ markdown, metadata: {}, statusCode: 404 });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(outcrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw PageNotFoundError for 404 status', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse('Not Found', {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(outcrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw error for other HTTP errors', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse('', {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(outcrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Outcrawl request failed with status 401: Unauthorized',
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(new TypeError('fetch failed'));

    await expect(outcrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should throw TimeoutError when request times out', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(new TimeoutError('Request timeout'));

    await expect(outcrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      TimeoutError,
    );
  });

  it('should throw ResponseBodyParseError when JSON parsing fails', async () => {
    process.env.OUTCRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse('not json', { ok: true });
    mockResponse.json = vi.fn().mockRejectedValue(new Error('Invalid JSON'));
    mockResponse.clone.mockReturnValue({
      ...mockResponse,
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      text: vi.fn().mockResolvedValue('not json'),
    });

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(mockResponse as any);

    await expect(outcrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Outcrawl returned non-JSON response: not json',
    );
  });
});
