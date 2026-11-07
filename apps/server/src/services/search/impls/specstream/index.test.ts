// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpecStreamImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    json: vi.fn().mockResolvedValue(body),
    ok,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

describe('SpecStreamImpl', () => {
  let impl: SpecStreamImpl;

  beforeEach(() => {
    impl = new SpecStreamImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.SPECSTREAM_API_KEY = 'test-specstream-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SPECSTREAM_API_KEY;
  });

  it('should send the question with the bearer key and map sources to results', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createMockResponse({
        data: {
          passages: [{ text: 'Full page text', title: 'First', url: 'https://example.com/a' }],
          sources: [
            {
              cited: true,
              published: '2026-10-01',
              site: 'example.com',
              snippet: 'First snippet',
              title: 'First',
              url: 'https://example.com/a',
            },
            {
              cited: false,
              site: 'other.org',
              snippet: 'Second snippet',
              title: 'Second',
              url: 'https://other.org/b',
            },
          ],
        },
      }),
    );

    const result = await impl.query('who wrote it');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(
      'https://api.specstream.ai/v1/web-search?passages=true&q=who+wrote+it',
    );
    expect(init).toMatchObject({
      headers: { Authorization: 'Bearer test-specstream-key' },
      method: 'GET',
    });
    expect(result.query).toBe('who wrote it');
    expect(result.resultNumbers).toBe(2);
    expect(result.results[0]).toEqual({
      category: 'general',
      content: 'Full page text',
      engines: ['specstream'],
      parsedUrl: 'example.com',
      publishedDate: '2026-10-01',
      score: 1,
      title: 'First',
      url: 'https://example.com/a',
    });
    expect(result.results[1]).toMatchObject({
      content: 'Second snippet',
      publishedDate: undefined,
      score: 0.5,
    });
  });

  it('should cut the question at 2000 characters', async () => {
    vi.mocked(fetch).mockResolvedValue(createMockResponse({ data: { sources: [] } }));

    await impl.query('a'.repeat(2500));

    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get('q')).toHaveLength(2000);
  });

  it('should return no results when the reply has no sources', async () => {
    vi.mocked(fetch).mockResolvedValue(createMockResponse({ data: {} }));

    const result = await impl.query('nothing');

    expect(result.results).toEqual([]);
    expect(result.resultNumbers).toBe(0);
  });

  it('should throw SERVICE_UNAVAILABLE on an HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createMockResponse({ error: 'no balance' }, false, 402, 'Payment Required'),
    );

    await expect(impl.query('test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'SpecStream request failed: Payment Required',
    });
  });

  it('should throw SERVICE_UNAVAILABLE when the connection fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    await expect(impl.query('test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Failed to connect to SpecStream.',
    });
  });
});
