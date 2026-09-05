import { EMPTY_SEARCH_RESULTS_PROMPT } from '@lobechat/prompts';
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
      expect(result.content).toBe(EMPTY_SEARCH_RESULTS_PROMPT);
      expect(result.content).toContain('do not resend the same query');
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

  describe('crawlMultiPages', () => {
    it('should keep the failing url and guidance visible for error items', async () => {
      const mockSearchService = {
        crawlPages: vi.fn().mockResolvedValue({
          results: [
            {
              crawler: 'naive',
              data: {
                content: 'x'.repeat(20),
                contentType: 'text',
                title: 'OK page',
                url: 'https://ok.example.com/',
              },
              originalUrl: 'https://ok.example.com/',
            },
            {
              crawler: 'search1api',
              data: {
                content:
                  'Dead link: the server confirmed this page does not exist (HTTP 404). Do not retry this URL.',
                errorMessage: 'Not Found',
                errorType: 'PageNotFoundError',
                retryable: false,
              },
              originalUrl: 'https://raw.githubusercontent.com/foo/bar/main/env.release',
            },
          ],
        }),
        webSearch: vi.fn(),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.crawlMultiPages({
        urls: [
          'https://ok.example.com/',
          'https://raw.githubusercontent.com/foo/bar/main/env.release',
        ],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('<page url="https://ok.example.com/" title="OK page"');
      expect(result.content).toContain(
        '<error errorType="PageNotFoundError" errorMessage="Not Found" url="https://raw.githubusercontent.com/foo/bar/main/env.release">Dead link: the server confirmed this page does not exist (HTTP 404). Do not retry this URL.</error>',
      );
    });
  });
});
