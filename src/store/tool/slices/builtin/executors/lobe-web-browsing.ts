/**
 * Lobe Web Browsing Executor
 *
 * Handles web search and page crawling tool calls.
 */
import { WebBrowsingApiName, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';
import {
  type BuiltinToolContext,
  type BuiltinToolResult,
  type CrawlMultiPagesQuery,
  type CrawlPluginState,
  type SearchQuery,
} from '@lobechat/types';
import { BaseExecutor, SEARCH_SEARXNG_NOT_CONFIG } from '@lobechat/types';
import { type CrawlSuccessResult } from '@lobechat/web-crawler';

import { notebookService } from '@/services/notebook';
import { searchService } from '@/services/search';

const runtime = new WebBrowsingExecutionRuntime({ searchService });

class WebBrowsingExecutor extends BaseExecutor<typeof WebBrowsingApiName> {
  readonly identifier = WebBrowsingManifest.identifier;
  protected readonly apiEnum = WebBrowsingApiName;

  /**
   * Search the web
   */
  search = async (params: SearchQuery, ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    try {
      // Check if aborted
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await runtime.search(params, { signal: ctx.signal });

      if (result.success) {
        return {
          content: result.content,
          state: result.state,
          success: true,
        };
      }

      // Handle specific error cases
      const error = result.error as Error;
      if (error?.message === SEARCH_SEARXNG_NOT_CONFIG) {
        return {
          error: {
            body: { provider: 'searxng' },
            message: 'SearXNG is not configured',
            type: 'PluginSettingsInvalid',
          },
          success: false,
        };
      }

      return {
        error: {
          body: result.error,
          message: error?.message || 'Search failed',
          type: 'PluginServerError',
        },
        success: false,
      };
    } catch (e) {
      const err = e as Error;

      // Handle abort error
      if (err.name === 'AbortError' || err.message.includes('The user aborted a request.')) {
        return { stop: true, success: false };
      }

      return {
        error: {
          body: e,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Crawl a single page
   */
  crawlSinglePage = async (
    params: { url: string },
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.crawlMultiPages({ urls: [params.url] }, ctx);
  };

  /**
   * Crawl multiple pages
   */
  crawlMultiPages = async (
    params: CrawlMultiPagesQuery,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      // Check if aborted
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await runtime.crawlMultiPages(params);

      if (result.success) {
        // Save crawled pages as documents if topicId is available
        const savedDocuments: Array<{ id: string; title: string; url: string }> = [];

        if (ctx.topicId) {
          const crawlState = result.state as CrawlPluginState;

          // Create documents for each successfully crawled page
          await Promise.all(
            crawlState.results.map(async (crawlResult) => {
              // Skip if there's an error
              if ('errorMessage' in crawlResult.data) return;

              const pageData = crawlResult.data as CrawlSuccessResult;
              if (!pageData.content) return;

              try {
                const document = await notebookService.createDocument({
                  content: pageData.content,
                  description: pageData.description || `Crawled from ${pageData.url}`,
                  source: pageData.url,
                  sourceType: 'web',
                  title: pageData.title || pageData.url,
                  topicId: ctx.topicId!,
                  type: 'article',
                });

                savedDocuments.push({
                  id: document.id,
                  title: document.title || pageData.url,
                  url: pageData.url,
                });
              } catch {
                // Silently ignore document creation errors to not block the main flow
              }
            }),
          );
        }

        // Append saved documents info to content
        let content = result.content;
        if (savedDocuments.length > 0) {
          const savedDocsInfo = savedDocuments
            .map((doc) => `- "${doc.title}" (ID: ${doc.id})`)
            .join('\n');
          content += `\n\n<saved_documents>\nThe crawled content has been saved as documents for future reference:\n${savedDocsInfo}\n</saved_documents>`;
        }

        return {
          content,
          state: {
            ...result.state,
            savedDocuments,
          },
          success: true,
        };
      }

      return {
        content: result.content,
        error: {
          body: result.error,
          message: (result.error as Error)?.message || 'Crawl failed',
          type: 'PluginServerError',
        },
        success: false,
      };
    } catch (e) {
      const err = e as Error;

      // Handle abort error
      if (err.name === 'AbortError' || err.message.includes('The user aborted a request.')) {
        return { stop: true, success: false };
      }

      return {
        error: {
          body: e,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };
}

// Export the executor instance for registration
export const webBrowsing = new WebBrowsingExecutor();
