import { crawlResultsPrompt, searchResultsPrompt } from '@lobechat/prompts';
import type {
  BuiltinServerRuntimeOutput,
  CrawlMultiPagesQuery,
  CrawlSinglePageQuery,
  SearchContent,
  SearchQuery,
  SearchServiceImpl,
} from '@lobechat/types';
import type { CrawlSuccessResult } from '@lobechat/web-crawler';

import { CRAWL_CONTENT_LIMITED_COUNT, SEARCH_ITEM_LIMITED_COUNT } from '../const';

export interface WebBrowsingDocumentService {
  associateDocument: (documentId: string) => Promise<void>;
  createDocument: (params: {
    content: string;
    description?: string;
    title: string;
    url: string;
  }) => Promise<{ id: string }>;
}

export interface WebBrowsingRuntimeOptions {
  agentId?: string;
  documentService?: WebBrowsingDocumentService;
  searchService: SearchServiceImpl;
  topicId?: string;
}

export class WebBrowsingExecutionRuntime {
  private agentId?: string;
  private documentService?: WebBrowsingDocumentService;
  private searchService: SearchServiceImpl;
  private topicId?: string;

  constructor(options: WebBrowsingRuntimeOptions) {
    this.searchService = options.searchService;
    this.documentService = options.documentService;
    this.agentId = options.agentId;
    this.topicId = options.topicId;
  }

  async search(
    args: SearchQuery,
    options?: { signal?: AbortSignal },
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.searchService.webSearch(args as SearchQuery, options);

      // If search failed with error detail, return as failure
      if (data.errorDetail) {
        return {
          content: data.errorDetail,
          error: { message: data.errorDetail },
          state: data,
          success: false,
        };
      }

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

    // Save crawled pages as documents and associate with agent
    if (this.documentService) {
      await Promise.all(
        results.map(async (item) => {
          if ('errorMessage' in item.data) return;

          const pageData = item.data as CrawlSuccessResult;
          if (!pageData.content) return;

          try {
            const doc = await this.documentService!.createDocument({
              content: pageData.content,
              description: pageData.description || `Crawled from ${pageData.url}`,
              title: pageData.title || pageData.url,
              url: pageData.url,
            });

            await this.documentService!.associateDocument(doc.id);
          } catch (error) {
            console.error('[WebBrowsing] Failed to save crawl result to agent document:', error);
          }
        }),
      );
    }

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
