// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExaImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeExaResponse = (results: object[]) => ({
  requestId: 'req-123',
  resolvedSearchType: 'auto',
  results,
});

describe('ExaImpl', () => {
  let impl: ExaImpl;

  beforeEach(() => {
    impl = new ExaImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.EXA_API_KEY = 'test-exa-api-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EXA_API_KEY;
  });

  describe('query', () => {
    it('should return mapped results for a successful query', async () => {
      const exaResults = [
        {
          id: 'result-1',
          url: 'https://example.com/page',
          title: 'Example Title',
          text: 'Example content text',
          score: 0.95,
          publishedDate: '2024-01-01',
        },
        {
          id: 'result-2',
          url: 'https://another.com/page',
          title: 'Another Result',
          text: 'Another content text',
          score: 0.85,
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse(exaResults)));

      const result = await impl.query('test query');

      expect(result.query).toBe('test query');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        title: 'Example Title',
        url: 'https://example.com/page',
        content: 'Example content text',
        engines: ['exa'],
        category: 'general',
        score: 0.95,
        parsedUrl: 'example.com',
      });
    });

    it('should return empty results when results array is empty', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      const result = await impl.query('empty query');

      expect(result.resultNumbers).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should handle missing results field gracefully', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ requestId: 'req-123' }));

      const result = await impl.query('test');

      expect(result.resultNumbers).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should set date range for day time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('test', { searchTimeRange: 'day' });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      const body = JSON.parse(options.body as string);

      expect(body.startPublishedDate).toBeDefined();
      expect(body.endPublishedDate).toBeDefined();
    });

    it('should set date range for week time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('test', { searchTimeRange: 'week' });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.startPublishedDate).toBeDefined();
      expect(body.endPublishedDate).toBeDefined();
    });

    it('should not set date range for anytime', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('test', { searchTimeRange: 'anytime' });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.startPublishedDate).toBeUndefined();
      expect(body.endPublishedDate).toBeUndefined();
    });

    it('should filter category to news only', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('test', { searchCategories: ['news', 'general'] });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.category).toBe('news');
    });

    it('should not include category for non-news categories', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('test', { searchCategories: ['general'] });

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.category).toBeUndefined();
    });

    it('should include API key in request headers', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)['x-api-key']).toBe('test-exa-api-key');
    });

    it('should use empty string for API key when not set', async () => {
      delete process.env.EXA_API_KEY;

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)['x-api-key']).toBe('');
    });

    it('should use POST method', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect(options.method).toBe('POST');
    });

    it('should include query in request body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      await impl.query('my search query');

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.query).toBe('my search query');
      expect(body.numResults).toBe(10);
      expect(body.type).toBe('auto');
    });

    it('should throw SERVICE_UNAVAILABLE when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'));

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Exa.',
      });
    });

    it('should throw SERVICE_UNAVAILABLE when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({ error: 'Forbidden' }, false, 403, 'Forbidden'),
      );

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Exa request failed: Forbidden',
      });
    });

    it('should throw INTERNAL_SERVER_ERROR when response JSON parsing fails', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error('JSON parse error')),
        text: vi.fn().mockResolvedValue('not json'),
      } as unknown as Response);

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Exa response.',
      });
    });

    it('should use score 0 when result score is undefined', async () => {
      const exaResults = [
        {
          id: 'result-1',
          url: 'https://example.com',
          title: 'Test',
          text: 'Content',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse(exaResults)));

      const result = await impl.query('test');

      expect(result.results[0].score).toBe(0);
    });

    it('should use category from body for result category when news', async () => {
      const exaResults = [
        {
          id: 'result-1',
          url: 'https://example.com',
          title: 'News Article',
          text: 'News content',
          score: 0.9,
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse(exaResults)));

      const result = await impl.query('test', { searchCategories: ['news'] });

      expect(result.results[0].category).toBe('news');
    });

    it('should include costTime in the response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse([])));

      const result = await impl.query('test');

      expect(typeof result.costTime).toBe('number');
      expect(result.costTime).toBeGreaterThanOrEqual(0);
    });

    it('should use empty content when text is missing', async () => {
      const exaResults = [
        {
          id: 'result-1',
          url: 'https://example.com',
          title: 'Test',
          text: '',
          score: 0.9,
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeExaResponse(exaResults)));

      const result = await impl.query('test');

      expect(result.results[0].content).toBe('');
    });
  });
});
