import { Crawler } from '@lobechat/web-crawler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { holdWebBrowsingFee } from '@/business/server/web-browsing/billing';
import { toolsEnv } from '@/envs/tools';

import type { SearchImplType } from './impls';
import { createSearchServiceImpl } from './impls';
import { SearchService } from './index';

vi.mock('@lobechat/web-crawler');
vi.mock('./impls');
vi.mock('@/business/server/web-browsing/billing', () => ({ holdWebBrowsingFee: vi.fn() }));
vi.mock('@/envs/tools', () => ({
  toolsEnv: {
    CRAWL_CONCURRENCY: undefined,
    CRAWLER_IMPLS: '',
    CRAWLER_RETRY: undefined,
    SEARCH_PROVIDERS: '',
  },
}));

const billing = { operationId: 'op-1', toolCallId: 'call-1', userId: 'user-1' };

const response = (results: number, errorDetail?: string) => ({
  costTime: 1,
  errorDetail,
  query: 'q',
  resultNumbers: results,
  results: Array.from({ length: results }, (_, i) => ({
    content: `c${i}`,
    engines: [],
    parsedUrl: 'example.com',
    score: 1,
    title: `t${i}`,
    url: `https://example.com/${i}`,
  })),
});

const page = (crawler: string) => ({
  crawler,
  data: { content: 'Page content', contentType: 'text' },
  originalUrl: 'https://example.com',
});

const failedPage = (crawler: string) => ({
  crawler,
  data: { content: 'Fail', errorMessage: 'Not Found', errorType: 'PageNotFoundError' },
  originalUrl: 'https://example.com/missing',
});

describe('SearchService billing', () => {
  const settle = vi.fn();
  const providers: Record<string, { query: ReturnType<typeof vi.fn> }> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toolsEnv).SEARCH_PROVIDERS = 'exa,search1api';
    vi.mocked(toolsEnv).CRAWLER_IMPLS = 'jina,naive';
    vi.mocked(holdWebBrowsingFee).mockResolvedValue({ settle });
    vi.mocked(createSearchServiceImpl).mockImplementation((type?: SearchImplType) => {
      providers[type!] = { query: vi.fn() };
      return providers[type!] as any;
    });
  });

  describe('webSearch', () => {
    it('holds for every provider in the chain and charges the one that answered', async () => {
      const service = new SearchService({ billing });
      providers.exa.query.mockRejectedValue(new Error('exa down'));
      providers.search1api.query.mockResolvedValue(response(3));

      const result = await service.webSearch({ query: 'q' });

      expect(result.results).toHaveLength(3);
      expect(holdWebBrowsingFee).toHaveBeenCalledWith({
        candidates: ['exa', 'search1api'],
        context: billing,
        kind: 'search',
        units: 1,
      });
      expect(settle).toHaveBeenCalledWith([{ provider: 'search1api', units: 1 }]);
    });

    it('gives the fee back when no provider found anything', async () => {
      const service = new SearchService({ billing });
      providers.exa.query.mockResolvedValue(response(0));
      providers.search1api.query.mockResolvedValue(response(0));

      await service.webSearch({ query: 'q' });

      expect(settle).toHaveBeenCalledWith([]);
    });

    it('gives the fee back when every provider failed', async () => {
      const service = new SearchService({ billing });
      providers.exa.query.mockRejectedValue(new Error('exa down'));
      providers.search1api.query.mockRejectedValue(new Error('s1 down'));

      const result = await service.webSearch({ query: 'q' });

      expect(result.errorDetail).toBeTruthy();
      expect(settle).toHaveBeenCalledWith([]);
    });

    it('never calls a provider when the fee is refused', async () => {
      const service = new SearchService({ billing });
      vi.mocked(holdWebBrowsingFee).mockRejectedValue(new Error('Not enough credits'));

      await expect(service.webSearch({ query: 'q' })).rejects.toThrow('Not enough credits');
      expect(providers.exa.query).not.toHaveBeenCalled();
      expect(providers.search1api.query).not.toHaveBeenCalled();
    });

    it('holds nothing without a billing context', async () => {
      const service = new SearchService();
      providers.exa.query.mockResolvedValue(response(1));

      await service.webSearch({ query: 'q' });

      expect(holdWebBrowsingFee).not.toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('holds for and charges the first provider only', async () => {
      const service = new SearchService({ billing });
      providers.exa.query.mockResolvedValue(response(2));

      await service.query('q');

      expect(holdWebBrowsingFee).toHaveBeenCalledWith(
        expect.objectContaining({ candidates: ['exa'], kind: 'search', units: 1 }),
      );
      expect(settle).toHaveBeenCalledWith([{ provider: 'exa', units: 1 }]);
    });
  });

  describe('crawlPages', () => {
    const mockCrawler = (crawl: ReturnType<typeof vi.fn>) =>
      vi.mocked(Crawler).mockImplementation(function () {
        return { crawl, impls: ['jina', 'naive'], urlRuleImpls: ['jina', 'naive'] } as any;
      });

    it('holds for every impl a page can land on and charges each served page', async () => {
      mockCrawler(
        vi
          .fn()
          .mockResolvedValueOnce(page('jina'))
          .mockResolvedValueOnce(page('jina'))
          .mockResolvedValueOnce(failedPage('naive')),
      );
      const service = new SearchService({ billing });

      await service.crawlPages({
        impls: ['search1api'],
        urls: ['https://a.com', 'https://b.com', 'https://c.com'],
      });

      expect(holdWebBrowsingFee).toHaveBeenCalledWith({
        candidates: ['jina', 'naive', 'search1api'],
        context: billing,
        kind: 'crawl',
        units: 3,
      });
      expect(settle).toHaveBeenCalledWith([{ provider: 'jina', units: 2 }]);
    });

    it('gives the fee back when the crawl throws', async () => {
      mockCrawler(vi.fn().mockRejectedValue(new Error('boom')));
      vi.mocked(toolsEnv).CRAWLER_RETRY = 0;
      const service = new SearchService({ billing });

      const { results } = await service.crawlPages({ urls: ['https://a.com'] });

      expect(results[0].crawler).toBe('unknown');
      expect(settle).toHaveBeenCalledWith([]);
      vi.mocked(toolsEnv).CRAWLER_RETRY = undefined;
    });
  });
});
