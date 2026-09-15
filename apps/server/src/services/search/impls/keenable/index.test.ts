// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeenableImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeKeenableResponse = (results: object[]) => ({ query: 'test', results });

describe('KeenableImpl', () => {
  let impl: KeenableImpl;

  beforeEach(() => {
    impl = new KeenableImpl();
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.KEENABLE_API_KEY;
    delete process.env.KEENABLE_API_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KEENABLE_API_KEY;
    delete process.env.KEENABLE_API_URL;
  });

  describe('query', () => {
    it('should return mapped results for a successful query', async () => {
      // A realistic result: the API returns both fields and `description` is
      // frequently empty, with `snippet` carrying the page text.
      const keenableResults = [
        {
          title: 'Example Title',
          url: 'https://example.com/page',
          description: '',
          snippet: 'Example page text',
          published_at: '2026-01-15T10:30:00Z',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse(makeKeenableResponse(keenableResults)),
      );

      const result = await impl.query('test query');

      expect(result.query).toBe('test query');
      expect(result.resultNumbers).toBe(1);
      expect(result.results[0]).toMatchObject({
        title: 'Example Title',
        url: 'https://example.com/page',
        content: 'Example page text',
        engines: ['keenable'],
        category: 'general',
        score: 1,
        parsedUrl: 'example.com',
      });
    });

    it('falls back to description when snippet is absent', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse(
          makeKeenableResponse([
            {
              title: 'Example Title',
              url: 'https://example.com/page',
              description: 'A description',
            },
          ]),
        ),
      );

      const result = await impl.query('test query');

      expect(result.results[0].content).toBe('A description');
    });

    it('collapses whitespace and caps the content', async () => {
      // Snippets are raw page text: newlines in them, and far longer than the
      // snippet the other providers return.
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockResponse(
          makeKeenableResponse([
            {
              title: 'Example Title',
              url: 'https://example.com/page',
              description: '',
              snippet: 'line one\n\nline two' + ' padding'.repeat(500),
            },
          ]),
        ),
      );

      const { content } = (await impl.query('test query')).results[0];

      expect(content).toHaveLength(500);
      expect(content).not.toContain('\n');
      expect(content.startsWith('line one line two')).toBe(true);
    });

    it('uses the keyless public endpoint and no API key header by default', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeKeenableResponse([])));

      await impl.query('test');

      const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.keenable.ai/v1/search/public');
      expect((options.headers as Record<string, string>)['X-API-Key']).toBeUndefined();
      expect((options.headers as Record<string, string>)['X-Keenable-Title']).toBe('LobeChat');
      expect(options.method).toBe('POST');
    });

    it('uses the keyed endpoint and X-API-Key when a key is set', async () => {
      process.env.KEENABLE_API_KEY = 'secret-key';
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeKeenableResponse([])));

      await impl.query('test');

      const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.keenable.ai/v1/search');
      expect((options.headers as Record<string, string>)['X-API-Key']).toBe('secret-key');
    });

    it('falls back to keyless when the key is blank', async () => {
      process.env.KEENABLE_API_KEY = '   ';
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeKeenableResponse([])));

      await impl.query('test');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toBe('https://api.keenable.ai/v1/search/public');
    });

    it('honours KEENABLE_API_URL override', async () => {
      process.env.KEENABLE_API_URL = 'https://staging.keenable.ai';
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeKeenableResponse([])));

      await impl.query('test');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toBe('https://staging.keenable.ai/v1/search/public');
    });

    it('should throw SERVICE_UNAVAILABLE when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Keenable.',
      });
    });

    it('should throw SERVICE_UNAVAILABLE when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({ error: 'Unauthorized' }, false, 401, 'Unauthorized'),
      );

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Keenable request failed: Unauthorized',
      });
    });

    it('should throw INTERNAL_SERVER_ERROR when response JSON parsing fails', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
        text: vi.fn().mockResolvedValue('invalid json'),
      } as unknown as Response);

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Keenable response.',
      });
    });
  });
});
