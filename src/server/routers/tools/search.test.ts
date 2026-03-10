// @vitest-environment node
import { SEARCH_SEARXNG_NOT_CONFIG } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toolsEnv } from '@/envs/tools';
import { SearXNGClient } from '@/server/services/search/impls/searxng/client';

import { searchRouter } from './search';

// Mock JWT verification
vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn().mockReturnValue({ userId: '1' }),
}));

vi.mock('@lobechat/web-crawler', () => ({
  Crawler: vi.fn().mockImplementation(() => ({
    crawl: vi.fn().mockResolvedValue({ content: 'test content' }),
  })),
}));

vi.mock('@/server/services/search/impls/searxng/client');

describe('searchRouter', () => {
  const mockContext = {
    userId: 'test-user-id',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-ignore
    toolsEnv.SEARXNG_URL = 'http://test-searxng.com';
  });

  describe('crawlPages', () => {
    it('should crawl multiple pages successfully', async () => {
      const caller = searchRouter.createCaller(mockContext as any);

      const result = await caller.crawlPages({
        urls: ['http://test1.com', 'http://test2.com'],
        impls: ['naive'],
      });

      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({ content: 'test content' });
      expect(result.results[1]).toEqual({ content: 'test content' });
    });

    it('should accept all supported crawler implementations', async () => {
      const caller = searchRouter.createCaller(mockContext as any);

      const allImpls = [
        'browserless',
        'exa',
        'firecrawl',
        'jina',
        'naive',
        'search1api',
        'tavily',
      ] as const;
      for (const impl of allImpls) {
        const result = await caller.crawlPages({
          urls: ['http://test.com'],
          impls: [impl],
        });
        expect(result.results).toHaveLength(1);
      }
    });

    it('should work without specifying impls', async () => {
      const caller = searchRouter.createCaller(mockContext as any);

      const result = await caller.crawlPages({
        urls: ['http://test.com'],
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({ content: 'test content' });
    });
  });

  describe('query', () => {
    it('should return error detail if SEARXNG_URL is not configured', async () => {
      // @ts-ignore
      toolsEnv.SEARXNG_URL = undefined;

      const caller = searchRouter.createCaller(mockContext as any);

      const result = await caller.query({
        query: 'test query',
      });

      expect(result).toMatchObject({
        errorDetail: SEARCH_SEARXNG_NOT_CONFIG,
        query: 'test query',
        resultNumbers: 0,
        results: [],
      });
    });

    it('should return search results successfully', async () => {
      const mockSearchResult = {
        results: [
          {
            title: 'Test Result',
            url: 'http://test.com',
            content: 'Test content',
          },
        ],
      };

      (SearXNGClient as any).mockImplementation(() => ({
        search: vi.fn().mockResolvedValue(mockSearchResult),
      }));

      const caller = searchRouter.createCaller(mockContext as any);

      const result = await caller.query({
        optionalParams: {
          searchEngines: ['google'],
        },
        query: 'test query',
      });

      expect(result).toMatchObject({
        query: 'test query',
        results: [
          {
            title: 'Test Result',
            parsedUrl: 'test.com',
            url: 'http://test.com',
            content: 'Test content',
          },
        ],
      });
    });

    it('should work without specifying search engines', async () => {
      const mockSearchResult = {
        results: [
          {
            title: 'Test Result',
            url: 'http://test.com',
            content: 'Test content',
          },
        ],
      };

      (SearXNGClient as any).mockImplementation(() => ({
        search: vi.fn().mockResolvedValue(mockSearchResult),
      }));

      const caller = searchRouter.createCaller(mockContext as any);

      const result = await caller.query({
        query: 'test query',
      });

      expect(result).toMatchObject({
        query: 'test query',
        results: [
          {
            title: 'Test Result',
            parsedUrl: 'test.com',
            url: 'http://test.com',
            content: 'Test content',
          },
        ],
      });
    });

    it('should return error detail when search fails', async () => {
      (SearXNGClient as any).mockImplementation(() => ({
        search: vi.fn().mockRejectedValue(new Error('Search failed')),
      }));

      const caller = searchRouter.createCaller(mockContext as any);

      const result = await caller.query({
        query: 'test query',
      });

      expect(result).toMatchObject({
        errorDetail: 'Search failed',
        query: 'test query',
        resultNumbers: 0,
        results: [],
      });
    });
  });
});
