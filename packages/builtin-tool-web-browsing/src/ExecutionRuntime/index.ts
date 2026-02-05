import { crawlResultsPrompt, searchResultsPrompt } from '@lobechat/prompts';
import type {
  BuiltinServerRuntimeOutput,
  CrawlMultiPagesQuery,
  CrawlSinglePageQuery,
  SearchContent,
  SearchQuery,
  SearchServiceImpl,
} from '@lobechat/types';

import { CRAWL_CONTENT_LIMITED_COUNT, SEARCH_ITEM_LIMITED_COUNT } from '../const';

export class WebBrowsingExecutionRuntime {
  private searchService: SearchServiceImpl;

  constructor(options: { searchService: SearchServiceImpl }) {
    this.searchService = options.searchService;
  }

  async search(
    args: SearchQuery,
    options?: { signal?: AbortSignal },
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.searchService.webSearch(args as SearchQuery, options);

      // add LIMITED_COUNT search results to message content
      const searchContent: SearchContent[] = data.results
        .slice(0, SEARCH_ITEM_LIMITED_COUNT)
        .map((item) => ({
          title: item.title,
          url: item.url,
          ...(item.content && { content: item.content }),
          ...(item.publishedDate && { publishedDate: item.publishedDate }),
          ...(item.imgSrc && { imgSrc: item.imgSrc }),
          ...(item.thumbnail && { thumbnail: item.thumbnail }),
        }));

      // Convert to XML format to save tokens
      const xmlContent = searchResultsPrompt(searchContent);

      return { content: xmlContent, state: data, success: true };
    } catch (e) {
      return { content: (e as Error).message, error: e, success: false };
    }
  }

  async crawlSinglePage(args: CrawlSinglePageQuery): Promise<BuiltinServerRuntimeOutput> {
    return this.crawlMultiPages({ urls: [args.url] });
  }

  async crawlMultiPages(args: CrawlMultiPagesQuery): Promise<BuiltinServerRuntimeOutput> {
    const response = await this.searchService.crawlPages({
      urls: args.urls,
    });

    const { results } = response;

    const content = results.map((item) =>
      'errorMessage' in item
        ? item
        : {
            ...item.data,
            // if crawl too many content
            // slice the top 10000 char
            content: item.data.content?.slice(0, CRAWL_CONTENT_LIMITED_COUNT),
          },
    );
    const xmlContent = crawlResultsPrompt(content as any);

    return {
      content: xmlContent,
      state: response,
      success: true,
    };
  }
}
