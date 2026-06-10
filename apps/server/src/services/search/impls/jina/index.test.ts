// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JinaImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

describe('JinaImpl', () => {
  let impl: JinaImpl;

  beforeEach(() => {
    impl = new JinaImpl();
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.JINA_API_KEY;
    delete process.env.JINA_READER_API_KEY;
    delete process.env.JINA_USE_CN_DOMAINS;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.JINA_API_KEY;
    delete process.env.JINA_READER_API_KEY;
    delete process.env.JINA_USE_CN_DOMAINS;
  });

  it('should query the default jina search domain', async () => {
    process.env.JINA_READER_API_KEY = 'test-jina-key';

    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse({
        data: [
          {
            description: 'Example description',
            title: 'Example title',
            url: 'https://example.com/page',
          },
        ],
      }),
    );

    const result = await impl.query('test query');

    expect(fetch).toHaveBeenCalledWith('https://s.jina.ai/', {
      body: JSON.stringify({ q: 'test query' }),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer test-jina-key',
        'Content-Type': 'application/json',
        'X-Respond-With': 'no-content',
      },
      method: 'POST',
    });

    expect(result).toMatchObject({
      query: 'test query',
      resultNumbers: 1,
      results: [
        {
          category: 'general',
          content: 'Example description',
          engines: ['jina'],
          parsedUrl: 'example.com',
          score: 1,
          title: 'Example title',
          url: 'https://example.com/page',
        },
      ],
    });
  });

  it('should query the cn search domain when JINA_USE_CN_DOMAINS is true', async () => {
    process.env.JINA_USE_CN_DOMAINS = 'true';

    vi.mocked(fetch).mockResolvedValueOnce(
      createMockResponse({
        data: [],
      }),
    );

    await impl.query('test query');

    expect(fetch).toHaveBeenCalledWith(
      'https://s.jinaai.cn/',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
