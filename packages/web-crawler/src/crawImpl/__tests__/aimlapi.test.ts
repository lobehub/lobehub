import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import { HTTPStatusError, NetworkConnectionError } from '../../utils/errorType';
import { aimlapi } from '../aimlapi';
import { crawlImpls } from '../index';

vi.mock('../../utils/withTimeout', () => ({
  DEFAULT_TIMEOUT: 30000,
  withTimeout: vi.fn(),
}));

const longText = 'Markdown content returned by the AI/ML API Toolbox for this page. '.repeat(3);

describe('aimlapi crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.AIMLAPI_API_KEY;
  });

  it('is registered as a crawler impl', () => {
    expect(crawlImpls.aimlapi).toBe(aimlapi);
  });

  it('returns page text from the exa/contents tool run', async () => {
    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(
      createMockResponse({
        is_error: false,
        output: { results: [{ text: longText, title: 'Example', url: 'https://example.com/' }] },
        status: 'completed',
      }),
    );

    const result = await aimlapi('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: longText,
      contentType: 'text',
      length: longText.length,
      siteName: 'example.com',
      title: 'Example',
      url: 'https://example.com/',
    });
  });

  it('sends the key only to tools.aimlapi.com and refuses redirects', async () => {
    process.env.AIMLAPI_API_KEY = 'test-aimlapi-key';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createMockResponse({ output: { results: [{ text: longText }] }, status: 'completed' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockImplementation((fn: any) => fn(new AbortController().signal));

    await aimlapi('https://other-host.example/page', { filterOptions: {} });

    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).host).toBe('tools.aimlapi.com');
    expect(new URL(url).protocol).toBe('https:');
    expect(init.headers.Authorization).toBe('Bearer test-aimlapi-key');
    // A redirect to another host must fail instead of forwarding the Authorization header.
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toEqual({
      input: { text: true, urls: ['https://other-host.example/page'] },
      tool: 'exa/contents',
    });
    // The page URL itself is never contacted with the key.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when the tool run failed', async () => {
    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(
      createMockResponse({ error: { message: 'boom' }, is_error: true, status: 'failed' }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await aimlapi('https://example.com', { filterOptions: {} })).toBeUndefined();
    warn.mockRestore();
  });

  it('returns undefined for too-short content', async () => {
    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(
      createMockResponse({ output: { results: [{ text: 'short' }] }, status: 'completed' }),
    );

    expect(await aimlapi('https://example.com', { filterOptions: {} })).toBeUndefined();
  });

  it('throws an HTTP status error on non-ok responses', async () => {
    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockResolvedValue(
      createMockResponse('Unauthorized', { ok: false, status: 401, statusText: 'Unauthorized' }),
    );

    await expect(aimlapi('https://example.com', { filterOptions: {} })).rejects.toBeInstanceOf(
      HTTPStatusError,
    );
  });

  it('maps fetch failures to a network error', async () => {
    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(new TypeError('fetch failed'));

    await expect(aimlapi('https://example.com', { filterOptions: {} })).rejects.toBeInstanceOf(
      NetworkConnectionError,
    );
  });
});
