import { type SearchQuery } from '@lobechat/types';

import { toolsClient } from '@/libs/trpc/client';

class SearchService {
  search(query: string, optionalParams?: object) {
    return toolsClient.search.query.query({ optionalParams, query });
  }

  crawlPage(url: string) {
    return toolsClient.search.crawlPages.mutate({ urls: [url] });
  }

  crawlPages(params: { urls: string[] }) {
    return toolsClient.search.crawlPages.mutate(params);
  }

  async webSearch(params: SearchQuery, options?: { signal?: AbortSignal }) {
    return toolsClient.search.webSearch.query(params, { signal: options?.signal });
  }
}

export const searchService = new SearchService();
