import { describe, expect, it, vi } from 'vitest';

import { WebBrowsingExecutionRuntime } from './index';

describe('WebBrowsingExecutionRuntime', () => {
  describe('search', () => {
    it('should return success with search results', async () => {
      const mockSearchService = {
        crawlPages: vi.fn(),
        webSearch: vi.fn().mockResolvedValue({
          costTime: 100,
          query: 'test',
          resultNumbers: 1,
          results: [
            {
              content: 'Test content',
              engines: ['google'],
              parsedUrl: 'example.com',
              score: 1,
              title: 'Test',
              url: 'https://example.com',
            },
          ],
        }),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.search({ query: 'test' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('searchResults');
      expect(result.content).toContain('Test');
    });

    it('should return success: false when response has errorDetail', async () => {
      const mockSearchService = {
        crawlPages: vi.fn(),
        webSearch: vi.fn().mockResolvedValue({
          costTime: 0,
          errorDetail: 'Failed to search: 500 Internal Server Error',
          query: 'test',
          resultNumbers: 0,
          results: [],
        }),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.search({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to search: 500 Internal Server Error');
      expect(result.error).toEqual({ message: 'Failed to search: 500 Internal Server Error' });
    });

    it('should return success: true with empty results when no errorDetail', async () => {
      const mockSearchService = {
        crawlPages: vi.fn(),
        webSearch: vi.fn().mockResolvedValue({
          costTime: 50,
          query: 'test',
          resultNumbers: 0,
          results: [],
        }),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.search({ query: 'test' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('<searchResults />');
    });

    it('should return success: false when webSearch throws', async () => {
      const mockSearchService = {
        crawlPages: vi.fn(),
        webSearch: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.search({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.content).toBe('Network error');
    });
  });
});
