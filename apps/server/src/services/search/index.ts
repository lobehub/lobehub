import type { SearchParams, SearchQuery, UserChannelPreferences } from '@lobechat/types';
import type { Crawler, CrawlImplType, CrawlUniformResult } from '@lobechat/web-crawler';
import debug from 'debug';
import pMap from 'p-map';

import { toolsEnv } from '@/envs/tools';

import { type SearchImplType, type SearchServiceImpl } from './impls';
import { createSearchServiceImpl } from './impls';

const DEFAULT_CRAWL_CONCURRENCY = 3;
const DEFAULT_CRAWLER_RETRY = 1;
const log = debug('lobe-oom:web-browsing:search-service');

/**
 * Built-in crawler impl order applied when `CRAWLER_IMPLS` is not configured.
 *
 * Intentional copy of `DEFAULT_CRAWL_IMPLS` from `@lobechat/web-crawler`: the
 * search service only loads `@lobechat/web-crawler` lazily inside `crawlPages`,
 * so importing this value eagerly would pull the whole crawler module graph
 * into every request path. Drift between the two is guarded by a test that
 * asserts equality against the package export.
 */
export const DEFAULT_CRAWLER_IMPLS = ['jina', 'naive', 'search1api', 'browserless'];

/**
 * Search provider order applied when `SEARCH_PROVIDERS` is not configured.
 *
 * Mirrors the runtime default: when no provider is enabled via env, the service
 * falls back to a single SearXNG provider (see `createSearchServiceImpl`'s
 * default `type` of `SearchImplType.SearXNG`). Keeping this list in sync with
 * that default guarantees the settings page shows exactly the channels the
 * runtime can actually use.
 */
export const DEFAULT_SEARCH_IMPLS = ['searxng'];

const parseImplEnv = (envString: string = '') => {
  // Handle full-width commas and extra whitespace
  const envValue = envString.replaceAll('，', ',').trim();
  return envValue.split(',').filter(Boolean);
};

/**
 * Resolve the effective ordered channel list from a user's preferred order
 * intersected with the server-enabled set.
 *
 * - The user's order is authoritative for priority: only ids present in the
 *   enabled set are kept, in the user's order.
 * - When the user has no preference, or the intersection is empty (e.g. all
 *   preferred ids are unknown/disabled), fall back to the server default order
 *   (`enabledOrder`) unchanged — so an unconfigured user behaves exactly as before.
 */
export const resolveOrderedChannels = (
  userOrder: string[] | undefined,
  enabledOrder: string[],
): string[] => {
  if (!userOrder?.length) return enabledOrder;

  const enabledSet = new Set(enabledOrder);
  const filtered = userOrder.filter((id) => enabledSet.has(id));

  return filtered.length > 0 ? filtered : enabledOrder;
};

export interface SearchServiceOptions {
  /**
   * User-level ordered channel preferences (search providers / crawler impls).
   * Each list is intersected with the server-enabled set and reordered by the
   * user's priority; missing or fully-filtered lists fall back to the env order.
   */
  userChannels?: UserChannelPreferences;
}

const buildSearchParams = ({
  searchCategories,
  searchEngines,
  searchTimeRange,
}: SearchParams): SearchParams | undefined => {
  const params: SearchParams = {};

  if (searchCategories?.length) {
    params.searchCategories = searchCategories;
  }

  if (searchEngines?.length) {
    params.searchEngines = searchEngines;
  }

  if (searchTimeRange && searchTimeRange !== 'anytime') {
    params.searchTimeRange = searchTimeRange;
  }

  return Object.keys(params).length > 0 ? params : undefined;
};

const getMemorySnapshot = () => {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
    return 'non-node';
  }

  const { heapUsed, rss } = process.memoryUsage();

  return `rss=${(rss / 1024 / 1024).toFixed(1)}MB heap=${(heapUsed / 1024 / 1024).toFixed(1)}MB`;
};

/**
 * Search service class
 * Uses different implementations for different search operations
 */
export class SearchService {
  private searchImpList: SearchServiceImpl[];
  private userChannels?: UserChannelPreferences;

  private get crawlerImpls() {
    const enabledFromEnv = parseImplEnv(toolsEnv.CRAWLER_IMPLS);

    // No user preference → preserve current behavior exactly: forward the env
    // list as-is (possibly empty, letting `Crawler` apply its own defaults).
    if (!this.userChannels?.crawlerImpls?.length) return enabledFromEnv;

    // When crawler impls aren't configured via env, the effective enabled set
    // is the Crawler's built-in default order — intersect against that so a
    // user preference still resolves in a default deployment.
    const enabledSet = enabledFromEnv.length > 0 ? enabledFromEnv : DEFAULT_CRAWLER_IMPLS;

    return resolveOrderedChannels(this.userChannels.crawlerImpls, enabledSet);
  }

  private get crawlConcurrency() {
    return toolsEnv.CRAWL_CONCURRENCY ?? DEFAULT_CRAWL_CONCURRENCY;
  }

  private get crawlerRetry() {
    return toolsEnv.CRAWLER_RETRY ?? DEFAULT_CRAWLER_RETRY;
  }

  constructor(options: SearchServiceOptions = {}) {
    this.userChannels = options.userChannels;

    const impls = this.searchImpls;
    this.searchImpList =
      impls.length > 0
        ? impls.map((impl) => createSearchServiceImpl(impl))
        : [createSearchServiceImpl()];
  }

  /**
   * Server-enabled channel candidates in env default order, for the client to
   * render a channel-ordering picker. Returns objects (rather than bare ids) to
   * leave room for future per-channel metadata. Both lists fall back to their
   * built-in runtime defaults when the corresponding env (`SEARCH_PROVIDERS` /
   * `CRAWLER_IMPLS`) is not configured, so the picker shows exactly what the
   * runtime would actually use.
   */
  static getAvailableChannels(): {
    crawlerImpls: { id: string }[];
    searchProviders: { id: string }[];
  } {
    const enabledProviders = parseImplEnv(toolsEnv.SEARCH_PROVIDERS);
    // Match the runtime default (single SearXNG provider) when unconfigured, so
    // the settings page never shows "no channels available" while search still works.
    const searchProviders = enabledProviders.length > 0 ? enabledProviders : DEFAULT_SEARCH_IMPLS;
    const enabledCrawlers = parseImplEnv(toolsEnv.CRAWLER_IMPLS);
    const crawlerImpls = enabledCrawlers.length > 0 ? enabledCrawlers : DEFAULT_CRAWLER_IMPLS;

    return {
      crawlerImpls: crawlerImpls.map((id) => ({ id })),
      searchProviders: searchProviders.map((id) => ({ id })),
    };
  }

  async crawlPages(input: { impls?: CrawlImplType[]; urls: string[] }) {
    try {
      if (log.enabled) {
        log(
          'crawlPages:start urls=%d impls=%s mem=%s',
          input.urls.length,
          (input.impls || this.crawlerImpls).join(',') || '-',
          getMemorySnapshot(),
        );
      }
    } catch {}

    const { Crawler } = await import('@lobechat/web-crawler');
    const crawler = new Crawler({ impls: this.crawlerImpls });

    const results = await pMap(
      input.urls,
      async (url) => {
        return await this.crawlWithRetry(crawler, url, input.impls);
      },
      { concurrency: this.crawlConcurrency },
    );

    return { results };
  }

  private async crawlWithRetry(
    crawler: Crawler,
    url: string,
    impls?: CrawlImplType[],
  ): Promise<CrawlUniformResult> {
    const maxAttempts = this.crawlerRetry + 1;
    let lastResult: CrawlUniformResult | undefined;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await crawler.crawl({ impls, url });
        try {
          if (log.enabled) {
            log('crawlWithRetry:result crawler=%s mem=%s', result.crawler, getMemorySnapshot());
          }
        } catch {}
        lastResult = result;

        if (!this.isFailedCrawlResult(result)) {
          return result;
        }
      } catch (error) {
        lastError = error as Error;
      }
    }

    if (lastResult) {
      return lastResult;
    }

    return {
      crawler: 'unknown',
      data: {
        content: `Fail to crawl the page. Error type: ${lastError?.name || 'UnknownError'}, error message: ${lastError?.message}`,
        errorMessage: lastError?.message,
        errorType: lastError?.name || 'UnknownError',
      },
      originalUrl: url,
    };
  }

  /**
   * A successful crawl result always includes `contentType` (e.g. 'text', 'json')
   * in `result.data`, while a failed result contains `errorType`/`errorMessage` instead.
   */
  private isFailedCrawlResult(result: CrawlUniformResult): boolean {
    return !('contentType' in result.data);
  }

  private get searchImpls() {
    const enabledFromEnv = parseImplEnv(toolsEnv.SEARCH_PROVIDERS);

    // No user preference → preserve current behavior exactly: forward the env
    // list as-is (possibly empty, letting the constructor apply its own default).
    if (!this.userChannels?.searchProviders?.length) return enabledFromEnv as SearchImplType[];

    // When search providers aren't configured via env, the effective enabled set
    // is the runtime's built-in default (SearXNG) — intersect against that so a
    // user preference still resolves in a default deployment.
    const enabledSet = enabledFromEnv.length > 0 ? enabledFromEnv : DEFAULT_SEARCH_IMPLS;

    return resolveOrderedChannels(
      this.userChannels.searchProviders,
      enabledSet,
    ) as SearchImplType[];
  }

  /**
   * Query for search results using the specified impl
   */
  private async queryWithImpl(impl: SearchServiceImpl, query: string, params?: SearchParams) {
    try {
      return await impl.query(query, params);
    } catch (e) {
      console.error('[SearchService] query failed:', (e as Error).message);
      return {
        costTime: 0,
        errorDetail: (e as Error).message,
        query,
        resultNumbers: 0,
        results: [],
      };
    }
  }

  /**
   * Query for search results (uses the first provider)
   */
  async query(query: string, params?: SearchParams) {
    return this.queryWithImpl(this.searchImpList[0], query, params);
  }

  async webSearch({ query, searchCategories, searchEngines, searchTimeRange }: SearchQuery) {
    try {
      if (log.enabled) {
        log(
          'webSearch:start providers=%d q=%d c=%d e=%d mem=%s',
          this.searchImpList.length,
          query.length,
          searchCategories?.length || 0,
          searchEngines?.length || 0,
          getMemorySnapshot(),
        );
      }
    } catch {}

    for (const impl of this.searchImpList) {
      try {
        if (log.enabled) {
          log(
            'webSearch:impl impl=%s mem=%s',
            impl.constructor.name || 'UnknownSearchImpl',
            getMemorySnapshot(),
          );
        }
      } catch {}

      let currentParams = buildSearchParams({
        searchCategories,
        searchEngines: impl.useAutoSearchEngineSelection ? undefined : searchEngines,
        searchTimeRange,
      });
      let data = await this.queryWithImpl(impl, query, currentParams);

      // First retry: remove search engine restrictions if no results found
      if (data.results.length === 0 && currentParams?.searchEngines?.length) {
        currentParams = buildSearchParams({
          searchCategories,
          searchTimeRange,
        });
        data = await this.queryWithImpl(impl, query, currentParams);
      }

      // Second retry: remove all restrictions if still no results found
      if (data.results.length === 0 && currentParams) {
        data = await this.queryWithImpl(impl, query);
      }

      // If this provider returned results, use them
      if (data.results.length > 0) {
        return data;
      }
    }

    // All providers exhausted, return empty result
    return { costTime: 0, query, resultNumbers: 0, results: [] };
  }
}
