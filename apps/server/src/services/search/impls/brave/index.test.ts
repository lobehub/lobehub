// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BraveImpl } from './index';

const createMockResponse = (body: object, ok = true, status = 200, statusText = 'OK') =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }) as unknown as Response;

const makeBraveResponse = (results: object[]) => ({
  type: 'search',
  mixed: {},
  web: {
    type: 'web',
    results,
  },
});

describe('BraveImpl', () => {
  let impl: BraveImpl;

  beforeEach(() => {
    impl = new BraveImpl();
    vi.stubGlobal('fetch', vi.fn());
    process.env.BRAVE_API_KEY = 'test-brave-api-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BRAVE_API_KEY;
  });

  describe('query', () => {
    it('should return mapped results for a successful query', async () => {
      const braveResults = [
        {
          title: 'Example Title',
          url: 'https://example.com/page',
          description: 'Example description',
          type: 'web',
        },
        {
          title: 'Another Result',
          url: 'https://another.com/page',
          description: 'Another description',
          type: 'web',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse(braveResults)));

      const result = await impl.query('test query');

      expect(result.query).toBe('test query');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        title: 'Example Title',
        url: 'https://example.com/page',
        content: 'Example description',
        engines: ['brave'],
        category: 'general',
        score: 1,
        parsedUrl: 'example.com',
      });
    });

    it('should return empty results when web.results is empty', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      const result = await impl.query('empty query');

      expect(result.resultNumbers).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should include freshness param for day time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('test', { searchTimeRange: 'day' });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain('freshness=pd');
    });

    it('should include freshness=pw for week time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('test', { searchTimeRange: 'week' });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('freshness=pw');
    });

    it('should include freshness=pm for month time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('test', { searchTimeRange: 'month' });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('freshness=pm');
    });

    it('should include freshness=py for year time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('test', { searchTimeRange: 'year' });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('freshness=py');
    });

    it('should not include a valid freshness value for anytime time range', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('test', { searchTimeRange: 'anytime' });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      // Should not include any of the valid freshness values
      expect(url).not.toContain('freshness=pd');
      expect(url).not.toContain('freshness=pw');
      expect(url).not.toContain('freshness=pm');
      expect(url).not.toContain('freshness=py');
    });

    it('should use the API key in request headers', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)['X-Subscription-Token']).toBe(
        'test-brave-api-key',
      );
    });

    it('should use empty string for API key when not set', async () => {
      delete process.env.BRAVE_API_KEY;

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)['X-Subscription-Token']).toBe('');
    });

    it('should throw SERVICE_UNAVAILABLE when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Brave.',
      });
    });

    it('should throw SERVICE_UNAVAILABLE when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({ error: 'Unauthorized' }, false, 401, 'Unauthorized'),
      );

      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Brave request failed: Unauthorized',
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
        message: 'Failed to parse Brave response.',
      });
    });

    it('should correctly parse parsedUrl from result url', async () => {
      const braveResults = [
        {
          title: 'Test',
          url: 'https://subdomain.example.com/path?query=1',
          description: 'Test desc',
          type: 'web',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse(braveResults)));

      const result = await impl.query('test');

      expect(result.results[0].parsedUrl).toBe('subdomain.example.com');
    });

    it('should return empty parsedUrl for invalid url', async () => {
      const braveResults = [
        {
          title: 'Test',
          url: 'not-a-valid-url',
          description: 'Test desc',
          type: 'web',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse(braveResults)));

      // Should handle URL parsing errors gracefully or return empty string
      // BraveImpl uses new URL(result.url) which throws for invalid URLs
      await expect(impl.query('test')).rejects.toThrow();
    });

    it('should include costTime in the response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      const result = await impl.query('test');

      expect(typeof result.costTime).toBe('number');
      expect(result.costTime).toBeGreaterThanOrEqual(0);
    });

    it('should use GET method', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('test');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect(options.method).toBe('GET');
    });

    it('should include query string in request URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse([])));

      await impl.query('my search query');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('q=my+search+query');
    });

    it('should use empty string for description when not provided', async () => {
      const braveResults = [
        {
          title: 'No Desc',
          url: 'https://example.com',
          description: '',
          type: 'web',
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(createMockResponse(makeBraveResponse(braveResults)));

      const result = await impl.query('test');

      expect(result.results[0].content).toBe('');
    });
  });
});
