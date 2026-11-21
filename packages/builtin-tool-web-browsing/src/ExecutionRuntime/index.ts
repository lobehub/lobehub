import { crawlResultsPrompt, searchResultsPrompt } from '@lobechat/prompts';
import { appendTextWindowNotice, sliceTextWindow } from '@lobechat/prompts/textWindow';
import type {
  BuiltinServerRuntimeOutput,
  CrawlMultiPagesQuery,
  CrawlSinglePageQuery,
  SearchContent,
  SearchQuery,
  SearchServiceImpl,
} from '@lobechat/types';
import type { CrawlSuccessResult } from '@lobechat/web-crawler';

import {
  CRAWL_CONTENT_LIMITED_COUNT,
  CRAWL_SAVE_MAX_CHARS,
  SEARCH_ITEM_LIMITED_COUNT,
} from '../const';

const MAX_LOGGED_ERROR_LENGTH = 500;

/**
 * One-line summary of a document save failure. A Drizzle "Failed query" error
 * embeds every bound parameter (the whole page and its editor JSON) in its
 * message, so log the innermost driver cause, truncated.
 */
const describeSaveError = (error: unknown): string => {
  let current = error;
  while (current instanceof Error && current.cause !== undefined) current = current.cause;

  const code = (current as { code?: unknown } | null)?.code;
  const message = current instanceof Error ? current.message : String(current);
  const summary = typeof code === 'string' ? `${code} ${message}` : message;

  return summary.length > MAX_LOGGED_ERROR_LENGTH
    ? `${summary.slice(0, MAX_LOGGED_ERROR_LENGTH)}…`
    : summary;
};

export interface WebBrowsingDocumentService {
  /** Returns the agent document binding when one was created, so its id can be handed to the model. */
  associateDocument: (documentId: string) => Promise<{ id?: string } | void>;
  createDocument: (params: {
    content: string;
    /**
     * Crawler content type from `CrawlSuccessResult`. The persistence layer
     * wraps `json` bodies in a fenced code block — the markdown snapshot
     * guard rejects raw JSON (markdown parsing would rewrite it), but fenced
     * blocks are stored byte-exact.
     */
    contentType?: 'json';
    description?: string;
    title: string;
    url: string;
  }) => Promise<{ id: string }>;
}

export interface WebBrowsingRuntimeOptions {
  agentId?: string;
  /**
   * Whether `lobe-agent-documents` is in this run's final tool set. A truncated page only names
   * `readDocument` on its saved copy when the model can actually call it; chat mode or a custom
   * tool set with browsing alone still saves the page but reports what was left out instead.
   */
  canReadSavedDocuments?: boolean;
  documentService?: WebBrowsingDocumentService;
  searchService: SearchServiceImpl;
  topicId?: string;
}

export class WebBrowsingExecutionRuntime {
  private agentId?: string;
  private canReadSavedDocuments: boolean;
  private documentService?: WebBrowsingDocumentService;
  private searchService: SearchServiceImpl;
  private topicId?: string;

  constructor(options: WebBrowsingRuntimeOptions) {
    this.searchService = options.searchService;
    this.documentService = options.documentService;
    this.canReadSavedDocuments = options.canReadSavedDocuments ?? false;
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

    // Save crawled pages as documents and associate with agent. The agent document id lets a
    // truncated page point the model at the full saved copy.
    const savedDocumentIds = new Map<string, string>();
    if (this.documentService) {
      await Promise.all(
        results.map(async (item) => {
          if ('errorMessage' in item.data) return;

          const pageData = item.data as CrawlSuccessResult;
          if (!pageData.content) return;

          if (pageData.content.length > CRAWL_SAVE_MAX_CHARS) {
            console.warn(
              `[WebBrowsing] Skipped saving crawl result as a document, ${pageData.content.length} characters exceeds the ${CRAWL_SAVE_MAX_CHARS} limit (${pageData.url})`,
            );
            return;
          }

          try {
            const doc = await this.documentService!.createDocument({
              content: pageData.content,
              ...(pageData.contentType === 'json' && { contentType: 'json' }),
              description: pageData.description || `Crawled from ${pageData.url}`,
              title: pageData.title || pageData.url,
              url: pageData.url,
            });

            const binding = await this.documentService!.associateDocument(doc.id);
            if (binding?.id) savedDocumentIds.set(pageData.url, binding.id);
          } catch (error) {
            console.error(
              `[WebBrowsing] Failed to save crawl result to agent document (${pageData.url}): ${describeSaveError(error)}`,
            );
          }
        }),
      );
    }

    const content = results.map((item) => {
      // keep the failing url attached so the model knows which page to give up on
      if ('errorMessage' in item.data)
        return { ...item.data, url: item.data.url ?? item.originalUrl };

      const pageData = item.data as CrawlSuccessResult;
      if (!pageData.content || pageData.content.length <= CRAWL_CONTENT_LIMITED_COUNT) {
        return pageData;
      }

      const savedId = this.canReadSavedDocuments ? savedDocumentIds.get(pageData.url) : undefined;
      const window = sliceTextWindow(pageData.content, { maxChars: CRAWL_CONTENT_LIMITED_COUNT });

      return {
        ...pageData,
        content: appendTextWindowNotice(window, {
          continueFrom: savedId
            ? (line) =>
                `call lobe-agent-documents readDocument with id="${savedId}", format="markdown" and offset=${line}`
            : undefined,
        }),
      };
    });
    const xmlContent = crawlResultsPrompt(content as any);

    return {
      content: xmlContent,
      state: response,
      success: true,
    };
  }
}
