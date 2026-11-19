import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import {
  HTTPStatusError,
  NetworkConnectionError,
  PageNotFoundError,
  TimeoutError,
} from '../../utils/errorType';
import { withTimeout } from '../../utils/withTimeout';
import { clawifi } from '../clawifi';

vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 10_000,
  withTimeout: vi.fn((fn: (signal: AbortSignal) => Promise<Response>) =>
    fn(new AbortController().signal),
  ),
}));

const markdown = '# Example\n\nThis is a test markdown content with enough length to pass. '.repeat(
  3,
);

const fetchEnvelope = (overrides: Record<string, unknown> = {}) => ({
  cache_hit: false,
  content_status: 'ok',
  data: {
    content_markdown: markdown,
    entity_type: 'WebDocument',
    excerpt: 'An example page.',
    title: 'Example',
    url: 'https://example.com/post',
  },
  entity_type: 'WebDocument',
  errors: [],
  mode_used: 'http_fetch',
  source: 'generic_web',
  success: true,
  ...overrides,
});

describe('clawifi crawler', () => {
  const fetchMock = vi.fn();
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.CLAWIFI_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });

  it('should fetch the page with the API key', async () => {
    process.env.CLAWIFI_API_KEY = 'test-key';
    fetchMock.mockResolvedValue(createMockResponse(fetchEnvelope()));

    const result = await clawifi('https://example.com/post', { filterOptions: {} });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clawifi.dev/fetch',
      expect.objectContaining({
        body: JSON.stringify({ url: 'https://example.com/post' }),
        headers: { 'Authorization': 'Bearer test-key', 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(withTimeout).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(result).toEqual({
      content: markdown,
      contentType: 'text',
      description: 'An example page.',
      length: markdown.length,
      siteName: 'example.com',
      title: 'Example',
      url: 'https://example.com/post',
    });
  });

  it('should send an empty Authorization header without an API key', async () => {
    fetchMock.mockResolvedValue(createMockResponse(fetchEnvelope()));

    await clawifi('https://example.com/post', { filterOptions: {} });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('');
  });

  it('should fall back to the requested URL and empty strings for missing fields', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        fetchEnvelope({ data: { content_markdown: markdown, excerpt: null, title: null } }),
      ),
    );

    const result = await clawifi('https://example.com/post', { filterOptions: {} });

    expect(result).toMatchObject({
      description: '',
      title: '',
      url: 'https://example.com/post',
    });
  });

  it('should accept thin content that is long enough', async () => {
    fetchMock.mockResolvedValue(createMockResponse(fetchEnvelope({ content_status: 'thin' })));

    const result = await clawifi('https://example.com/post', { filterOptions: {} });

    expect(result?.content).toBe(markdown);
  });

  it('should return undefined for short content', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        fetchEnvelope({ content_status: 'thin', data: { content_markdown: 'too short' } }),
      ),
    );

    await expect(clawifi('https://example.com', { filterOptions: {} })).resolves.toBeUndefined();
  });

  it('should return undefined when content_markdown is missing', async () => {
    fetchMock.mockResolvedValue(createMockResponse(fetchEnvelope({ data: { title: 'Paper' } })));

    await expect(clawifi('https://example.com', { filterOptions: {} })).resolves.toBeUndefined();
  });

  it.each(['blocked', 'needs_javascript', 'not_found'])(
    'should return undefined when content_status is %s',
    async (contentStatus) => {
      fetchMock.mockResolvedValue(
        createMockResponse(fetchEnvelope({ content_status: contentStatus })),
      );

      await expect(clawifi('https://example.com', { filterOptions: {} })).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    },
  );

  it('should return undefined when success is false', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        fetchEnvelope({
          errors: [{ code: 'upstream_request_failed', message: 'Read failed' }],
          success: false,
        }),
      ),
    );

    await expect(clawifi('https://example.com', { filterOptions: {} })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com'),
      'Read failed',
    );
  });

  it.each([404, 410])(
    'should throw PageNotFoundError when the target page answered %i',
    async (targetStatus) => {
      fetchMock.mockResolvedValue(
        createMockResponse(
          {
            error: {
              code: 'upstream_request_failed',
              details: {
                diagnostics: { block_type: 'not_found', retryable: false },
                status_code: targetStatus,
              },
              message: `GET https://example.com/missing failed after 1 attempt: HTTP Error ${targetStatus}: `,
              retryable: false,
            },
          },
          { ok: false, status: 424, statusText: 'Failed Dependency' },
        ),
      );

      const error = await clawifi('https://example.com/missing', { filterOptions: {} }).catch(
        (e) => e,
      );

      expect(error).toBeInstanceOf(PageNotFoundError);
      expect(error.status).toBe(targetStatus);
    },
  );

  it('should throw HTTPStatusError when the target page answered another error', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        {
          error: {
            code: 'upstream_request_failed',
            details: { status_code: 403 },
            message: 'GET https://example.com failed after 1 attempt: HTTP Error 403: ',
            retryable: false,
          },
        },
        { ok: false, status: 424, statusText: 'Failed Dependency' },
      ),
    );

    const error = await clawifi('https://example.com', { filterOptions: {} }).catch((e) => e);

    expect(error).toBeInstanceOf(HTTPStatusError);
    expect(error).not.toBeInstanceOf(PageNotFoundError);
    expect(error.status).toBe(424);
  });

  it('should include the Clawifi error body for other HTTP errors', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        {
          detail: 'Insufficient Clawifi credits: needed 1, balance 0',
          error: { code: 'insufficient_credits', retryable: false },
        },
        { ok: false, status: 402, statusText: 'Payment Required' },
      ),
    );

    await expect(clawifi('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Clawifi request failed with status 402: Payment Required. Response: {"detail":"Insufficient Clawifi credits',
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(clawifi('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should throw TimeoutError when the request times out', async () => {
    vi.mocked(withTimeout).mockRejectedValueOnce(new TimeoutError('Request timeout'));

    await expect(clawifi('https://example.com', { filterOptions: {} })).rejects.toThrow(
      TimeoutError,
    );
  });

  it('should throw ResponseBodyParseError when JSON parsing fails', async () => {
    const mockResponse = createMockResponse('not json', { ok: true });
    mockResponse.json = vi.fn().mockRejectedValue(new Error('Invalid JSON'));
    mockResponse.clone.mockReturnValue({
      ...mockResponse,
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      text: vi.fn().mockResolvedValue('not json'),
    });
    fetchMock.mockResolvedValue(mockResponse);

    await expect(clawifi('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Clawifi returned non-JSON response: not json',
    );
  });
});
