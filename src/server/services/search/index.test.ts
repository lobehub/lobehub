import { Crawler } from '@lobechat/web-crawler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toolsEnv } from '@/envs/tools';

import { createSearchServiceImpl,SearchImplType } from './impls';
import { SearchService } from './index';

// Mock dependencies
vi.mock('@lobechat/web-crawler');
vi.mock('./impls');
vi.mock('@/envs/tools', () => ({
  toolsEnv: {
    CRAWLER_IMPLS: '',
    SEARCH_PROVIDERS: '',
  },
}));

describe('SearchService', () => {
  let searchService: SearchService;
  let mockSearchImpl: ReturnType<typeof createMockSearchImpl>;

  function createMockSearchImpl() {
    return {
      query: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchImpl = createMockSearchImpl();
    vi.mocked(createSearchServiceImpl).mockReturnValue(mockSearchImpl as any);
    searchService = new SearchService();
  });

  describe('constructor', () => {
    it('should create instance with default search implementation when no providers configured', () => {
      expect(createSearchServiceImpl).toHaveBeenCalledWith(undefined);
    });

    it('should create instance with first provider from SEARCH_PROVIDERS', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'tavily,brave';
      searchService = new SearchService();
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Tavily);
    });

    it('should handle full-width comma in SEARCH_PROVIDERS', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'tavily，brave';
      searchService = new SearchService();
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Tavily);
    });

    it('should trim whitespace in SEARCH_PROVIDERS', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = '  tavily  ,  brave  ';
      searchService = new SearchService();
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Tavily);
    });
  });

  describe('query', () => {
    it('should call searchImpl.query with correct parameters', async () => {
      const mockResponse = {
        costTime: 100,
        query: 'test query',
        resultNumbers: 1,
        results: [],
      };
      mockSearchImpl.query.mockResolvedValue(mockResponse);

      const result = await searchService.query('test query');

      expect(mockSearchImpl.query).toHaveBeenCalledWith('test query', undefined);
      expect(result).toBe(mockResponse);
    });

    it('should pass search parameters to searchImpl.query', async () => {
      const mockResponse = {
        costTime: 100,
        query: 'test query',
        resultNumbers: 1,
        results: [],
      };
      mockSearchImpl.query.mockResolvedValue(mockResponse);

      const params = {
        searchCategories: ['general'],
        searchEngines: ['google'],
        searchTimeRange: '1d',
      };

      await searchService.query('test query', params);

      expect(mockSearchImpl.query).toHaveBeenCalledWith('test query', params);
    });
  });

  describe('webSearch', () => {
    it('should return results on first attempt if results found', async () => {
      const mockResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 2,
        results: [
          {
            category: 'general',
            content: 'Result 1',
            engines: ['google'],
            parsedUrl: 'https://example.com',
            score: 1,
            title: 'Test 1',
            url: 'https://example.com',
          },
        ],
      };
      mockSearchImpl.query.mockResolvedValue(mockResponse);

      const result = await searchService.webSearch({
        query: 'test',
        searchCategories: ['general'],
        searchEngines: ['google'],
      });

      expect(mockSearchImpl.query).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockResponse);
    });

    it('should retry without searchEngines when no results found', async () => {
      const emptyResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 0,
        results: [],
      };
      const successResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 1,
        results: [
          {
            category: 'general',
            content: 'Result 1',
            engines: ['google'],
            parsedUrl: 'https://example.com',
            score: 1,
            title: 'Test 1',
            url: 'https://example.com',
          },
        ],
      };

      mockSearchImpl.query
        .mockResolvedValueOnce(emptyResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await searchService.webSearch({
        query: 'test',
        searchCategories: ['general'],
        searchEngines: ['google'],
        searchTimeRange: '1d',
      });

      expect(mockSearchImpl.query).toHaveBeenCalledTimes(2);
      expect(mockSearchImpl.query).toHaveBeenNthCalledWith(1, 'test', {
        searchCategories: ['general'],
        searchEngines: ['google'],
        searchTimeRange: '1d',
      });
      expect(mockSearchImpl.query).toHaveBeenNthCalledWith(2, 'test', {
        searchCategories: ['general'],
        searchEngines: undefined,
        searchTimeRange: '1d',
      });
      expect(result).toBe(successResponse);
    });

    it('should retry without any params when still no results found', async () => {
      const emptyResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 0,
        results: [],
      };
      const successResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 1,
        results: [
          {
            category: 'general',
            content: 'Result 1',
            engines: ['google'],
            parsedUrl: 'https://example.com',
            score: 1,
            title: 'Test 1',
            url: 'https://example.com',
          },
        ],
      };

      mockSearchImpl.query
        .mockResolvedValueOnce(emptyResponse)
        .mockResolvedValueOnce(emptyResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await searchService.webSearch({
        query: 'test',
        searchCategories: ['general'],
        searchEngines: ['google'],
        searchTimeRange: '1d',
      });

      expect(mockSearchImpl.query).toHaveBeenCalledTimes(3);
      expect(mockSearchImpl.query).toHaveBeenNthCalledWith(3, 'test', undefined);
      expect(result).toBe(successResponse);
    });

    it('should skip second retry if searchEngines not provided', async () => {
      const emptyResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 0,
        results: [],
      };
      const successResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 1,
        results: [
          {
            category: 'general',
            content: 'Result 1',
            engines: ['google'],
            parsedUrl: 'https://example.com',
            score: 1,
            title: 'Test 1',
            url: 'https://example.com',
          },
        ],
      };

      mockSearchImpl.query
        .mockResolvedValueOnce(emptyResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await searchService.webSearch({
        query: 'test',
        searchCategories: ['general'],
      });

      expect(mockSearchImpl.query).toHaveBeenCalledTimes(2);
      expect(mockSearchImpl.query).toHaveBeenNthCalledWith(1, 'test', {
        searchCategories: ['general'],
        searchEngines: undefined,
        searchTimeRange: undefined,
      });
      expect(mockSearchImpl.query).toHaveBeenNthCalledWith(2, 'test', undefined);
      expect(result).toBe(successResponse);
    });

    it('should return empty results after all retries fail', async () => {
      const emptyResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 0,
        results: [],
      };

      mockSearchImpl.query.mockResolvedValue(emptyResponse);

      const result = await searchService.webSearch({
        query: 'test',
        searchEngines: ['google'],
      });

      expect(result.results).toHaveLength(0);
    });
  });

  describe('crawlPages', () => {
    it('should crawl multiple pages concurrently', async () => {
      const mockCrawlResult = {
        content: 'Page content',
        description: 'Page description',
        title: 'Page title',
        url: 'https://example.com',
      };

      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue(mockCrawlResult),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();

      const urls = ['https://example1.com', 'https://example2.com', 'https://example3.com'];
      const result = await searchService.crawlPages({ urls });

      expect(Crawler).toHaveBeenCalledWith({ impls: [] });
      expect(mockCrawler.crawl).toHaveBeenCalledTimes(3);
      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toBe(mockCrawlResult);
    });

    it('should use crawler implementations from env', async () => {
      vi.mocked(toolsEnv).CRAWLER_IMPLS = 'jina,reader';

      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue({}),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();

      await searchService.crawlPages({ urls: ['https://example.com'] });

      expect(Crawler).toHaveBeenCalledWith({ impls: ['jina', 'reader'] });
    });

    it('should pass impls parameter to crawler.crawl', async () => {
      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue({}),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();

      await searchService.crawlPages({
        impls: ['jina'],
        urls: ['https://example.com'],
      });

      expect(mockCrawler.crawl).toHaveBeenCalledWith({
        impls: ['jina'],
        url: 'https://example.com',
      });
    });
  });
});
