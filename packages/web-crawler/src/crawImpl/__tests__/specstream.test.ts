import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import { NetworkConnectionError, PageNotFoundError } from '../../utils/errorType';
import { withTimeout } from '../../utils/withTimeout';
import { specstream } from '../specstream';

vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 10_000,
  withTimeout: vi.fn((fn: (signal: AbortSignal) => Promise<Response>) =>
    fn(new AbortController().signal),
  ),
}));

const markdown = '# Example\n\nThis is a test markdown content with enough length to pass. '.repeat(
  3,
);

const page = (overrides: object = {}) => ({
  data: {
    request_id: 'req_1',
    results: [
      { status: 'ok', text: markdown, title: 'Example', url: 'https://example.com/post' },
    ].map((result) => ({ ...result, ...overrides })),
  },
});

describe('specstream crawler', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    process.env.SPECSTREAM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SPECSTREAM_API_KEY;
  });

  it('should extract the page with the bearer key', async () => {
    fetchMock.mockResolvedValue(createMockResponse(page()));

    const result = await specstream('https://example.com/post', { filterOptions: {} });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.specstream.ai/v1/extract',
      expect.objectContaining({
        body: JSON.stringify({ format: 'markdown', urls: ['https://example.com/post'] }),
        headers: { 'Authorization': 'Bearer test-key', 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(withTimeout).toHaveBeenCalledWith(expect.any(Function), 35_000);
    expect(result).toEqual({
      content: markdown,
      contentType: 'text',
      length: markdown.length,
      siteName: 'example.com',
      title: 'Example',
      url: 'https://example.com/post',
    });
  });

  it('should return undefined for short content', async () => {
    fetchMock.mockResolvedValue(createMockResponse(page({ text: 'too short' })));

    await expect(specstream('https://example.com', { filterOptions: {} })).resolves.toBeUndefined();
  });

  it.each(['blocked', 'empty', 'unsupported', 'failed'])(
    'should return undefined when the page status is %s',
    async (status) => {
      fetchMock.mockResolvedValue(createMockResponse(page({ status, text: '' })));

      await expect(
        specstream('https://example.com', { filterOptions: {} }),
      ).resolves.toBeUndefined();
    },
  );

  it('should throw PageNotFoundError when the page status is not_found', async () => {
    fetchMock.mockResolvedValue(createMockResponse(page({ status: 'not_found', text: '' })));

    await expect(specstream('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should include the error body for HTTP errors', async () => {
    fetchMock.mockResolvedValue(
      createMockResponse(
        { error: { message: 'Insufficient balance' } },
        { ok: false, status: 402, statusText: 'Payment Required' },
      ),
    );

    await expect(specstream('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'SpecStream request failed with status 402: Payment Required. Response: {"error":{"message":"Insufficient balance"',
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(specstream('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });
});
