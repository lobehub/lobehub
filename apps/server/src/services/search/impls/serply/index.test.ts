// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SerplyImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeSerplyResponse = (results: object[]) => ({ results, total: results.length });

describe('SerplyImpl', () => {
  let impl: SerplyImpl;

  beforeEach(() => {
    impl = new SerplyImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.SERPLY_API_KEY = 'test-serply-api-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SERPLY_API_KEY;
  });

  describe('query', () => {
    it('should return mapped results for a successful query', async () => {
      const serplyResults = [
        {
          title: 'Example Title',
          link: 'https://example.com/page',
          description: 'Example description',
          position: 1,
          result_type: 'organic',
        },
        {
          title: 'Another Result',
          link: 'https://another.com/page',
          description: 'Another description',
          position: 2,
          result_type: 'organic',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSerplyResponse(serplyResults)));

      const result = await impl.query('test query');

      expect(result.query).toBe('test query');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        title: 'Example Title',
        url: 'https://example.com/page',
        content: 'Example description',
        engines: ['serply'],
        category: 'general',
        score: 1,
        parsedUrl: 'example.com',
      });
    });

    it('should return empty results when results is empty', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSerplyResponse([])));

      const result = await impl.query('empty query');

      expect(result.resultNumbers).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should include tbs=qdr:d for day time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSerplyResponse([])));

      await impl.query('test', { searchTimeRange: 'day' });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('tbs=qdr%3Ad');
    });

    it('should include tbs=qdr:w for week time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSerplyResponse([])));

      await impl.query('test', { searchTimeRange: 'week' });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('tbs=qdr%3Aw');
    });

    it('should omit tbs entirely for anytime time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSerplyResponse([])));

      await impl.query('test', { searchTimeRange: 'anytime' });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).not.toContain('tbs=');
    });

    it('should send the API key and an identifying user agent', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSerplyResponse([])));

      await impl.query('test');

      const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = options.headers as Record<string, string>;
      expect(headers['X-Api-Key']).toBe('test-serply-api-key');
      expect(headers['User-Agent']).toBe('lobehub');
    });

    it('should use empty string for API key when not set', async () => {
      delete process.env.SERPLY_API_KEY;

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeSerplyResponse([])));

      await impl.query('test');

      const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect((options.headers as Record<string, string>)['X-Api-Key']).toBe('');
    });

    it('should throw SERVICE_UNAVAILABLE when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Serply.',
      });
    });

    it('should throw SERVICE_UNAVAILABLE when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({ error: 'Unauthorized' }, false, 401, 'Unauthorized'),
      );

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Serply request failed: Unauthorized',
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
        message: 'Failed to parse Serply response.',
      });
    });
  });
});
