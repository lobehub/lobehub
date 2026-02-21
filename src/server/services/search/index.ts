import { type SearchParams, type SearchQuery } from '@lobechat/types';
import { type CrawlImplType } from '@lobechat/web-crawler';
import pMap from 'p-map';

import { toolsEnv } from '@/envs/tools';

import { type SearchImplType, type SearchServiceImpl } from './impls';
import { createSearchServiceImpl } from './impls';

const parseImplEnv = (envString: string = '') => {
  // Handle full-width commas and extra whitespace
  const envValue = envString.replaceAll('，', ',').trim();
  return envValue.split(',').filter(Boolean);
};

/**
 * Search service class
 * Uses different implementations for different search operations
 */
export class SearchService {
  private searchImpl: SearchServiceImpl;

  private get crawlerImpls() {
    return parseImplEnv(toolsEnv.CRAWLER_IMPLS);
  }

  constructor() {
    const impls = this.searchImpls;
    // TODO: need use turn mode
    this.searchImpl = createSearchServiceImpl(impls.length > 0 ? impls[0] : undefined);
  }

  async crawlPages(input: { impls?: CrawlImplType[]; urls: string[] }) {
    const { Crawler } = await import('@lobechat/web-crawler');
    const crawler = new Crawler({ impls: this.crawlerImpls });

    const results = await pMap(
      input.urls,
      async (url) => {
        return await crawler.crawl({ impls: input.impls, url });
      },
      { concurrency: 3 },
    );

    return { results };
  }

  private get searchImpls() {
    return parseImplEnv(toolsEnv.SEARCH_PROVIDERS) as SearchImplType[];
  }

  /**
   * Query for search results
   */
  async query(query: string, params?: SearchParams) {
    return this.searchImpl.query(query, params);
  }

  async webSearch({ query, searchCategories, searchEngines, searchTimeRange }: SearchQuery) {
    let data = await this.query(query, {
      searchCategories: searchCategories,
      searchEngines: searchEngines,
      searchTimeRange: searchTimeRange,
    });

    // First retry: remove search engine restrictions if no results found
    if (data.results.length === 0 && searchEngines && searchEngines?.length > 0) {
      const paramsExcludeSearchEngines = {
        searchCategories: searchCategories,
        searchEngines: undefined,
        searchTimeRange: searchTimeRange,
      };
      data = await this.query(query, paramsExcludeSearchEngines);
    }

    // Second retry: remove all restrictions if still no results found
    if (data?.results.length === 0) {
      data = await this.query(query);
    }

    return data;
  }
}

// Add a default exported instance for convenience
export const searchService = new SearchService();
