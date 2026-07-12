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

  /**
   * Server-enabled search providers / crawler impls in the server default
   * priority order. Used by the Web Search settings page to render the
   * channel-ordering picker.
   */
  async getAvailableChannels() {
    return toolsClient.search.getAvailableChannels.query();
  }
}

export const searchService = new SearchService();
