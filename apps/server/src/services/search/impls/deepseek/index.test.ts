// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDeepSeekQuery, DeepSeekImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const getRequestBody = () => JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);

describe('DeepSeekImpl', () => {
  let impl: DeepSeekImpl;

  beforeEach(() => {
    impl = new DeepSeekImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.DEEPSEEK_SEARCH_API_KEY = 'test-search-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.DEEPSEEK_SEARCH_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('should opt into automatic search engine selection', () => {
    expect(new DeepSeekImpl().useAutoSearchEngineSelection).toBe(true);
  });

  it('should call the search endpoint and map results', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createMockResponse({
        results: [
          {
            authority: 3,
            content: '',
            date: '2026-10-16T16:00:00+00:00',
            rerank_score: 2.2,
            site_icon: null,
            site_name: 'Hugging Face',
            snippet: 'Short snippet',
            summary: 'Longer summary for the model',
            title: 'DeepSeek-V4',
            url: 'https://huggingface.co/collections/deepseek-ai/deepseek-v4',
          },
          { snippet: 'Only snippet', url: 'https://example.com/a' },
        ],
      }),
    );

    const result = await impl.query('DeepSeek V4');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/tools/search',
      expect.objectContaining({
        headers: { 'Authorization': 'Bearer test-search-key', 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(getRequestBody()).toEqual({ count: 10, need_content: false, query: 'DeepSeek V4' });
    expect(result.query).toBe('DeepSeek V4');
    expect(result.resultNumbers).toBe(2);
    expect(result.results).toEqual([
      {
        category: 'general',
        content: 'Longer summary for the model',
        engines: ['deepseek'],
        parsedUrl: 'huggingface.co',
        publishedDate: '2026-10-16T16:00:00+00:00',
        score: 2.2,
        title: 'DeepSeek-V4',
        url: 'https://huggingface.co/collections/deepseek-ai/deepseek-v4',
      },
      {
        category: 'general',
        content: 'Only snippet',
        engines: ['deepseek'],
        parsedUrl: 'example.com',
        publishedDate: undefined,
        score: 0,
        title: '',
        url: 'https://example.com/a',
      },
    ]);
  });

  it('should fall back to the DeepSeek model provider key', async () => {
    delete process.env.DEEPSEEK_SEARCH_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'model-key';
    vi.mocked(fetch).mockResolvedValue(createMockResponse({ results: [] }));

    const result = await impl.query('test');

    expect(vi.mocked(fetch).mock.calls[0][1]!.headers).toMatchObject({
      Authorization: 'Bearer model-key',
    });
    expect(result.resultNumbers).toBe(0);
  });

  it('should throw SERVICE_UNAVAILABLE on non-ok responses', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createMockResponse(
        { error: { message: 'Authentication Fails', type: 'authentication_error' } },
        false,
        401,
        'Unauthorized',
      ),
    );

    await expect(impl.query('test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'DeepSeek request failed: Unauthorized',
    });
  });

  it('should throw SERVICE_UNAVAILABLE when the request cannot be sent', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));

    await expect(impl.query('test')).rejects.toBeInstanceOf(TRPCError);
    await expect(impl.query('test')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('should send the time range as an after: operator', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
    vi.mocked(fetch).mockResolvedValue(createMockResponse({ results: [] }));

    await impl.query('news', { searchTimeRange: 'week' });

    expect(getRequestBody().query).toBe('news after:2026-10-13');
  });
});

describe('buildDeepSeekQuery', () => {
  it('should keep short queries and ignore anytime', () => {
    expect(buildDeepSeekQuery('  hello world  ', { searchTimeRange: 'anytime' })).toBe(
      'hello world',
    );
  });

  it('should truncate long queries to the 128 character limit', () => {
    const query = buildDeepSeekQuery('搜'.repeat(200));

    expect(Array.from(query)).toHaveLength(128);
  });

  it('should keep the time range operator when truncating', () => {
    const query = buildDeepSeekQuery('a'.repeat(200), { searchTimeRange: 'day' });

    expect(query).toHaveLength(128);
    expect(query).toMatch(/ after:\d{4}-\d{2}-\d{2}$/);
  });
});
