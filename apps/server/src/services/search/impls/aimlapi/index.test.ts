// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSearchServiceImpl, SearchImplType } from '../index';
import { AimlApiImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const completedRun = (results: object[]) => ({
  is_error: false,
  output: { results },
  status: 'completed',
  tool: 'web/search',
});

describe('AimlApiImpl', () => {
  let impl: AimlApiImpl;

  beforeEach(() => {
    impl = new AimlApiImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.AIMLAPI_API_KEY = 'test-aimlapi-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AIMLAPI_API_KEY;
  });

  it('is created for the aimlapi search channel', () => {
    expect(createSearchServiceImpl(SearchImplType.AimlApi)).toBeInstanceOf(AimlApiImpl);
  });

  it('runs the web/search tool and maps results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse(
        completedRun([
          { snippet: 'LobeHub snippet', title: 'LobeHub', url: 'https://lobehub.com/' },
          { title: 'Repo', url: 'https://github.com/lobehub/lobehub' },
        ]),
      ),
    );

    const result = await impl.query('lobehub');

    expect(result.query).toBe('lobehub');
    expect(result.resultNumbers).toBe(2);
    expect(result.results[0]).toMatchObject({
      content: 'LobeHub snippet',
      engines: ['aimlapi'],
      parsedUrl: 'lobehub.com',
      title: 'LobeHub',
      url: 'https://lobehub.com/',
    });
    expect(result.results[1].content).toBe('');

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toEqual({
      input: { include_domains: null, max_results: 15, query: 'lobehub' },
      tool: 'web/search',
    });
  });

  it('sends the key only to tools.aimlapi.com and refuses redirects', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(completedRun([])));

    await impl.query('test');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    const target = new URL(url as string);
    expect(target.protocol).toBe('https:');
    expect(target.host).toBe('tools.aimlapi.com');
    expect(target.pathname).toBe('/v1/tools/run');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer test-aimlapi-key');
    // A redirect to another host must fail instead of forwarding the Authorization header.
    expect(init!.redirect).toBe('error');
    expect(init!.headers).not.toHaveProperty('X-AIMLAPI-Source');
  });

  it('does not send a bearer token when no key is configured', async () => {
    delete process.env.AIMLAPI_API_KEY;
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(completedRun([])));

    await impl.query('test');

    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('');
  });

  it('throws SERVICE_UNAVAILABLE on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse({ error: 'bad key' }, false, 401, 'Unauthorized'),
    );

    await expect(impl.query('test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'AI/ML API request failed: Unauthorized',
    });
  });

  it('throws SERVICE_UNAVAILABLE when the tool run reports an error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse({ error: { message: 'upstream down' }, is_error: true, status: 'failed' }),
    );

    await expect(impl.query('test')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('throws SERVICE_UNAVAILABLE when fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed: redirect'));

    await expect(impl.query('test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Failed to connect to AI/ML API.',
    });
  });
});
