import { Crawler } from '@lobechat/web-crawler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toolsEnv } from '@/envs/tools';

import { createSearchServiceImpl, SearchImplType } from './impls';
import { DEFAULT_CRAWLER_IMPLS, resolveOrderedChannels, SearchService } from './index';

// Mock dependencies
vi.mock('@lobechat/web-crawler');
vi.mock('./impls');
vi.mock('@/envs/tools', () => ({
  toolsEnv: {
    CRAWL_CONCURRENCY: undefined,
    CRAWLER_IMPLS: '',
    CRAWLER_RETRY: undefined,
    SEARCH_PROVIDERS: '',
  },
}));

describe('SearchService', () => {
  let searchService: SearchService;
  let mockSearchImpl: ReturnType<typeof createMockSearchImpl>;

  function createMockSearchImpl() {
    return {
      query: vi.fn(),
      useAutoSearchEngineSelection: undefined as boolean | undefined,
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
      expect(createSearchServiceImpl).toHaveBeenCalledWith();
    });

    it('should create instances for all providers from SEARCH_PROVIDERS', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'tavily,brave';
      searchService = new SearchService();
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Tavily);
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Brave);
    });

    it('should handle full-width comma in SEARCH_PROVIDERS', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'tavily，brave';
      searchService = new SearchService();
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Tavily);
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Brave);
    });

    it('should trim whitespace in SEARCH_PROVIDERS', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = '  tavily  ,  brave  ';
      searchService = new SearchService();
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Tavily);
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Brave);
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

    it('should return errorDetail instead of throwing when impl fails', async () => {
      mockSearchImpl.query.mockRejectedValue(new Error('Service unavailable'));

      const result = await searchService.query('test query');

      expect(result).toEqual({
        costTime: 0,
        errorDetail: 'Service unavailable',
        query: 'test query',
        resultNumbers: 0,
        results: [],
      });
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
      });
      expect(mockSearchImpl.query).toHaveBeenNthCalledWith(2, 'test', undefined);
      expect(result).toBe(successResponse);
    });

    it('should not retry the same unrestricted query', async () => {
      const emptyResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 0,
        results: [],
      };

      vi.mocked(toolsEnv).SEARCH_PROVIDERS = '';
      searchService = new SearchService();
      mockSearchImpl.query.mockResolvedValue(emptyResponse);

      await searchService.webSearch({ query: 'test' });

      expect(mockSearchImpl.query).toHaveBeenCalledTimes(1);
      expect(mockSearchImpl.query).toHaveBeenCalledWith('test', undefined);
    });

    it('should omit searchEngines for providers that use auto engine selection', async () => {
      const successResponse = {
        costTime: 100,
        query: 'test',
        resultNumbers: 1,
        results: [
          {
            category: 'general',
            content: 'Result 1',
            engines: [],
            parsedUrl: 'https://example.com',
            score: 1,
            title: 'Test 1',
            url: 'https://example.com',
          },
        ],
      };
      mockSearchImpl.useAutoSearchEngineSelection = true;
      mockSearchImpl.query.mockResolvedValue(successResponse);

      const result = await searchService.webSearch({
        query: 'test',
        searchEngines: ['google', 'bing'],
      });

      expect(mockSearchImpl.query).toHaveBeenCalledTimes(1);
      expect(mockSearchImpl.query).toHaveBeenCalledWith('test', undefined);
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
      expect(result).toEqual({ costTime: 0, query: 'test', resultNumbers: 0, results: [] });
    });
  });

  describe('webSearch - provider fallback (turn mode)', () => {
    const emptyResponse = {
      costTime: 100,
      query: 'test',
      resultNumbers: 0,
      results: [],
    };
    const successResponse = {
      costTime: 200,
      query: 'test',
      resultNumbers: 1,
      results: [
        {
          category: 'general',
          content: 'Result from second provider',
          engines: ['exa'],
          parsedUrl: 'https://example.com',
          score: 1,
          title: 'Test',
          url: 'https://example.com',
        },
      ],
    };

    it('should fall back to second provider when first returns no results', async () => {
      const mockImpl1 = { query: vi.fn().mockResolvedValue(emptyResponse) };
      const mockImpl2 = { query: vi.fn().mockResolvedValue(successResponse) };

      vi.mocked(createSearchServiceImpl)
        .mockReturnValueOnce(mockImpl1 as any)
        .mockReturnValueOnce(mockImpl2 as any);

      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa';
      searchService = new SearchService();

      const result = await searchService.webSearch({ query: 'test' });

      // First provider tried once because there are no restrictions to remove.
      expect(mockImpl1.query).toHaveBeenCalledTimes(1);
      // Second provider returned results on first call
      expect(mockImpl2.query).toHaveBeenCalledTimes(1);
      expect(result).toBe(successResponse);
    });

    it('should try all providers in order and return empty when all fail', async () => {
      const mockImpl1 = { query: vi.fn().mockResolvedValue(emptyResponse) };
      const mockImpl2 = { query: vi.fn().mockResolvedValue(emptyResponse) };
      const mockImpl3 = { query: vi.fn().mockResolvedValue(emptyResponse) };

      vi.mocked(createSearchServiceImpl)
        .mockReturnValueOnce(mockImpl1 as any)
        .mockReturnValueOnce(mockImpl2 as any)
        .mockReturnValueOnce(mockImpl3 as any);

      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa,brave';
      searchService = new SearchService();

      const result = await searchService.webSearch({ query: 'test' });

      expect(mockImpl1.query).toHaveBeenCalled();
      expect(mockImpl2.query).toHaveBeenCalled();
      expect(mockImpl3.query).toHaveBeenCalled();
      expect(result.results).toHaveLength(0);
    });

    it('should not call later providers if first provider succeeds', async () => {
      const mockImpl1 = { query: vi.fn().mockResolvedValue(successResponse) };
      const mockImpl2 = { query: vi.fn() };

      vi.mocked(createSearchServiceImpl)
        .mockReturnValueOnce(mockImpl1 as any)
        .mockReturnValueOnce(mockImpl2 as any);

      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa';
      searchService = new SearchService();

      const result = await searchService.webSearch({ query: 'test' });

      expect(mockImpl1.query).toHaveBeenCalledTimes(1);
      expect(mockImpl2.query).not.toHaveBeenCalled();
      expect(result).toBe(successResponse);
    });

    it('should exhaust all retries on first provider before falling back', async () => {
      const mockImpl1 = { query: vi.fn().mockResolvedValue(emptyResponse) };
      const mockImpl2 = { query: vi.fn().mockResolvedValue(successResponse) };

      vi.mocked(createSearchServiceImpl)
        .mockReturnValueOnce(mockImpl1 as any)
        .mockReturnValueOnce(mockImpl2 as any);

      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa';
      searchService = new SearchService();

      const result = await searchService.webSearch({
        query: 'test',
        searchEngines: ['google'],
      });

      // First provider: full params -> without engines = 2 calls
      expect(mockImpl1.query).toHaveBeenCalledTimes(2);
      expect(mockImpl2.query).toHaveBeenCalledTimes(1);
      expect(result).toBe(successResponse);
    });

    it('should handle provider errors gracefully and continue to next', async () => {
      const errorResponse = {
        costTime: 0,
        errorDetail: 'Service unavailable',
        query: 'test',
        resultNumbers: 0,
        results: [],
      };
      const mockImpl1 = { query: vi.fn().mockRejectedValue(new Error('Service unavailable')) };
      const mockImpl2 = { query: vi.fn().mockResolvedValue(successResponse) };

      vi.mocked(createSearchServiceImpl)
        .mockReturnValueOnce(mockImpl1 as any)
        .mockReturnValueOnce(mockImpl2 as any);

      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa';
      searchService = new SearchService();

      const result = await searchService.webSearch({ query: 'test' });

      // First provider error results in empty results -> next provider
      expect(mockImpl2.query).toHaveBeenCalled();
      expect(result).toBe(successResponse);
    });
  });

  describe('crawlPages', () => {
    it('should crawl multiple pages concurrently', async () => {
      const mockCrawlResult = {
        crawler: 'naive',
        data: { content: 'Page content', contentType: 'text' },
        originalUrl: 'https://example.com',
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

      const mockSuccessResult = {
        crawler: 'jina',
        data: { content: 'ok', contentType: 'text' },
        originalUrl: 'https://example.com',
      };
      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue(mockSuccessResult),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();

      await searchService.crawlPages({ urls: ['https://example.com'] });

      expect(Crawler).toHaveBeenCalledWith({ impls: ['jina', 'reader'] });
    });

    it('should pass impls parameter to crawler.crawl', async () => {
      const mockSuccessResult = {
        crawler: 'jina',
        data: { content: 'ok', contentType: 'text' },
        originalUrl: 'https://example.com',
      };
      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue(mockSuccessResult),
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

    it('should use CRAWL_CONCURRENCY from env', async () => {
      vi.mocked(toolsEnv).CRAWL_CONCURRENCY = 1;

      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue({
          crawler: 'naive',
          data: { content: 'ok', contentType: 'text' },
          originalUrl: 'https://example.com',
        }),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();
      const urls = ['https://a.com', 'https://b.com'];
      await searchService.crawlPages({ urls });

      // All URLs should still be crawled
      expect(mockCrawler.crawl).toHaveBeenCalledTimes(2);
    });

    it('should retry on failed crawl results', async () => {
      vi.mocked(toolsEnv).CRAWLER_RETRY = 1;

      const failedResult = {
        crawler: 'naive',
        data: { content: 'Fail', errorType: 'NetworkError', errorMessage: 'timeout' },
        originalUrl: 'https://example.com',
      };
      const successResult = {
        crawler: 'naive',
        data: { content: 'Page content', contentType: 'text' },
        originalUrl: 'https://example.com',
      };

      const mockCrawler = {
        crawl: vi.fn().mockResolvedValueOnce(failedResult).mockResolvedValueOnce(successResult),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();
      const result = await searchService.crawlPages({ urls: ['https://example.com'] });

      expect(mockCrawler.crawl).toHaveBeenCalledTimes(2);
      expect(result.results[0]).toBe(successResult);
    });

    it('should return last failed result after all retries exhausted', async () => {
      vi.mocked(toolsEnv).CRAWLER_RETRY = 1;

      const failedResult = {
        crawler: 'naive',
        data: { content: 'Fail', errorType: 'NetworkError', errorMessage: 'timeout' },
        originalUrl: 'https://example.com',
      };

      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue(failedResult),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();
      const result = await searchService.crawlPages({ urls: ['https://example.com'] });

      expect(mockCrawler.crawl).toHaveBeenCalledTimes(2); // 1 + 1 retry
      expect(result.results[0]).toBe(failedResult);
    });

    it('should not retry when CRAWLER_RETRY is 0', async () => {
      vi.mocked(toolsEnv).CRAWLER_RETRY = 0;

      const failedResult = {
        crawler: 'naive',
        data: { content: 'Fail', errorType: 'Error', errorMessage: 'fail' },
        originalUrl: 'https://example.com',
      };

      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue(failedResult),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();
      const result = await searchService.crawlPages({ urls: ['https://example.com'] });

      expect(mockCrawler.crawl).toHaveBeenCalledTimes(1);
      expect(result.results[0]).toBe(failedResult);
    });

    it('should handle crawl exceptions during retry', async () => {
      vi.mocked(toolsEnv).CRAWLER_RETRY = 1;

      const mockCrawler = {
        crawl: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();
      const result = await searchService.crawlPages({ urls: ['https://example.com'] });

      expect(mockCrawler.crawl).toHaveBeenCalledTimes(2);
      expect(result.results[0].data).toMatchObject({
        errorType: 'Error',
        errorMessage: 'Network error',
      });
    });

    it('should detect successful results by contentType presence', async () => {
      vi.mocked(toolsEnv).CRAWLER_RETRY = 1;

      const successResult = {
        crawler: 'naive',
        data: { content: 'Page content', contentType: 'text' },
        originalUrl: 'https://example.com',
      };

      const mockCrawler = {
        crawl: vi.fn().mockResolvedValue(successResult),
      };
      vi.mocked(Crawler).mockImplementation(() => mockCrawler as any);

      searchService = new SearchService();
      const result = await searchService.crawlPages({ urls: ['https://example.com'] });

      // Should not retry since result has contentType (successful)
      expect(mockCrawler.crawl).toHaveBeenCalledTimes(1);
      expect(result.results[0]).toBe(successResult);
    });
  });

  describe('resolveOrderedChannels', () => {
    it('should return the enabled order untouched when no user order is given', () => {
      expect(resolveOrderedChannels(undefined, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
      expect(resolveOrderedChannels([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('should keep only enabled ids in the user order', () => {
      expect(resolveOrderedChannels(['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a']);
    });

    it('should drop unknown / disabled ids from the user order', () => {
      expect(resolveOrderedChannels(['x', 'b', 'y'], ['a', 'b', 'c'])).toEqual(['b']);
    });

    it('should fall back to the enabled order when intersection is empty', () => {
      expect(resolveOrderedChannels(['x', 'y'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });
  });

  describe('DEFAULT_CRAWLER_IMPLS', () => {
    it('should stay in sync with DEFAULT_CRAWL_IMPLS from @lobechat/web-crawler', async () => {
      // The local copy is an intentional duplicate to avoid eagerly importing
      // the crawler module graph; this guards against the two drifting apart.
      // `@lobechat/web-crawler` is auto-mocked in this file (which empties its
      // arrays), so read the real export via importActual.
      const { DEFAULT_CRAWL_IMPLS } = await vi.importActual<{ DEFAULT_CRAWL_IMPLS: string[] }>(
        '@lobechat/web-crawler',
      );

      expect(DEFAULT_CRAWLER_IMPLS).toEqual(DEFAULT_CRAWL_IMPLS);
    });
  });

  describe('user channel preferences - search providers', () => {
    it('should reorder providers by user preference intersected with env', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa,brave';
      // Drop the construction the shared beforeEach already recorded.
      vi.mocked(createSearchServiceImpl).mockClear();

      searchService = new SearchService({ userChannels: { searchProviders: ['exa', 'searxng'] } });

      // Providers are instantiated in the resolved (user) order.
      expect(createSearchServiceImpl).toHaveBeenNthCalledWith(1, SearchImplType.Exa);
      expect(createSearchServiceImpl).toHaveBeenNthCalledWith(2, SearchImplType.SearXNG);
      expect(createSearchServiceImpl).toHaveBeenCalledTimes(2);
    });

    it('should ignore user providers not enabled in env', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa';
      vi.mocked(createSearchServiceImpl).mockClear();

      searchService = new SearchService({
        userChannels: { searchProviders: ['tavily', 'exa'] },
      });

      expect(createSearchServiceImpl).toHaveBeenCalledTimes(1);
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.Exa);
    });

    it('should fall back to env order when user preference filters to empty', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa';
      vi.mocked(createSearchServiceImpl).mockClear();

      searchService = new SearchService({ userChannels: { searchProviders: ['tavily', 'brave'] } });

      expect(createSearchServiceImpl).toHaveBeenNthCalledWith(1, SearchImplType.SearXNG);
      expect(createSearchServiceImpl).toHaveBeenNthCalledWith(2, SearchImplType.Exa);
    });

    it('should intersect against the runtime default when SEARCH_PROVIDERS is empty', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = '';
      vi.mocked(createSearchServiceImpl).mockClear();

      // 'exa' is not a default provider, so it is dropped; only SearXNG remains,
      // matching what `getAvailableChannels` exposes to the settings page.
      searchService = new SearchService({ userChannels: { searchProviders: ['exa', 'searxng'] } });

      expect(createSearchServiceImpl).toHaveBeenCalledTimes(1);
      expect(createSearchServiceImpl).toHaveBeenCalledWith(SearchImplType.SearXNG);
    });

    it('should behave identically to no-config when userChannels is omitted', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa';
      vi.mocked(createSearchServiceImpl).mockClear();

      searchService = new SearchService();

      expect(createSearchServiceImpl).toHaveBeenNthCalledWith(1, SearchImplType.SearXNG);
      expect(createSearchServiceImpl).toHaveBeenNthCalledWith(2, SearchImplType.Exa);
    });
  });

  describe('user channel preferences - crawler impls', () => {
    const mockCrawler = () => {
      const crawler = {
        crawl: vi.fn().mockResolvedValue({
          crawler: 'jina',
          data: { content: 'ok', contentType: 'text' },
          originalUrl: 'https://example.com',
        }),
      };
      vi.mocked(Crawler).mockImplementation(() => crawler as any);
      return crawler;
    };

    it('should intersect user crawler impls with env in user order', async () => {
      vi.mocked(toolsEnv).CRAWLER_IMPLS = 'jina,naive,firecrawl';
      mockCrawler();

      searchService = new SearchService({
        userChannels: { crawlerImpls: ['firecrawl', 'jina'] },
      });
      await searchService.crawlPages({ urls: ['https://example.com'] });

      expect(Crawler).toHaveBeenCalledWith({ impls: ['firecrawl', 'jina'] });
    });

    it('should intersect against Crawler defaults when env is not configured', async () => {
      vi.mocked(toolsEnv).CRAWLER_IMPLS = '';
      mockCrawler();

      searchService = new SearchService({
        userChannels: { crawlerImpls: ['naive', 'jina', 'firecrawl'] },
      });
      await searchService.crawlPages({ urls: ['https://example.com'] });

      // 'firecrawl' is not a default impl, so it is dropped; the rest keep user order.
      expect(Crawler).toHaveBeenCalledWith({ impls: ['naive', 'jina'] });
    });

    it('should fall back to env impls when user preference filters to empty', async () => {
      vi.mocked(toolsEnv).CRAWLER_IMPLS = 'jina,naive';
      mockCrawler();

      searchService = new SearchService({ userChannels: { crawlerImpls: ['firecrawl'] } });
      await searchService.crawlPages({ urls: ['https://example.com'] });

      expect(Crawler).toHaveBeenCalledWith({ impls: ['jina', 'naive'] });
    });

    it('should forward the raw env list unchanged when userChannels is omitted', async () => {
      vi.mocked(toolsEnv).CRAWLER_IMPLS = '';
      mockCrawler();

      searchService = new SearchService();
      await searchService.crawlPages({ urls: ['https://example.com'] });

      // Preserves current behavior: empty list, letting Crawler apply defaults.
      expect(Crawler).toHaveBeenCalledWith({ impls: [] });
    });
  });

  describe('getAvailableChannels', () => {
    it('should return enabled channels in env default order', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng,exa,brave';
      vi.mocked(toolsEnv).CRAWLER_IMPLS = 'jina,naive';

      expect(SearchService.getAvailableChannels()).toEqual({
        crawlerImpls: [{ id: 'jina' }, { id: 'naive' }],
        searchProviders: [{ id: 'searxng' }, { id: 'exa' }, { id: 'brave' }],
      });
    });

    it('should fall back to Crawler default impls when CRAWLER_IMPLS is empty', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'searxng';
      vi.mocked(toolsEnv).CRAWLER_IMPLS = '';

      expect(SearchService.getAvailableChannels()).toEqual({
        crawlerImpls: [
          { id: 'jina' },
          { id: 'naive' },
          { id: 'search1api' },
          { id: 'browserless' },
        ],
        searchProviders: [{ id: 'searxng' }],
      });
    });

    it('should fall back to the runtime default provider when SEARCH_PROVIDERS is empty', () => {
      vi.mocked(toolsEnv).SEARCH_PROVIDERS = '';
      vi.mocked(toolsEnv).CRAWLER_IMPLS = 'jina';

      // Matches the runtime default (single SearXNG provider) so the settings
      // page never reports "no channels available" while search still works.
      expect(SearchService.getAvailableChannels()).toEqual({
        crawlerImpls: [{ id: 'jina' }],
        searchProviders: [{ id: 'searxng' }],
      });
    });
  });
});
