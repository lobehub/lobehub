// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeirolabsImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

describe('KeirolabsImpl', () => {
  let impl: KeirolabsImpl;

  beforeEach(() => {
    impl = new KeirolabsImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.KEIROLABS_API_KEY = 'test-keirolabs-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KEIROLABS_API_KEY;
  });

  it('selects its own search engines so an empty result is not retried', () => {
    expect(impl.useAutoSearchEngineSelection).toBe(true);
  });

  it('sends a Bearer-authenticated POST to the lite search endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ results: [] }));

    await impl.query('lobehub');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.keirolabs.cloud/api/v2/search/lite');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-keirolabs-key',
    );
    expect(JSON.parse(init?.body as string)).toEqual({ maxResults: 15, query: 'lobehub' });
  });

  it('maps results to the uniform shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse({
        results: [
          {
            domain: 'example.com',
            position: 1,
            score: 0.9,
            snippet: 'Example snippet',
            title: 'Example',
            url: 'https://example.com/page',
          },
          { title: 'No extras', url: 'https://other.org/a' },
        ],
      }),
    );

    const result = await impl.query('example');

    expect(result.resultNumbers).toBe(2);
    expect(result.results[0]).toEqual({
      category: 'general',
      content: 'Example snippet',
      engines: ['keirolabs'],
      parsedUrl: 'example.com',
      score: 0.9,
      title: 'Example',
      url: 'https://example.com/page',
    });
    expect(result.results[1]).toMatchObject({ content: '', parsedUrl: 'other.org', score: 1 });
  });

  it('throws SERVICE_UNAVAILABLE on a non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse({ error: 'Invalid API key' }, false, 401, 'Unauthorized'),
    );

    await expect(impl.query('x')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('throws SERVICE_UNAVAILABLE when fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));

    await expect(impl.query('x')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('throws INTERNAL_SERVER_ERROR when the body is not JSON', async () => {
    const bad = createMockResponse({});
    (bad.json as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new SyntaxError('bad json'));
    vi.mocked(fetch).mockResolvedValueOnce(bad);

    await expect(impl.query('x')).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});
