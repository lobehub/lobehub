/**
 * Lobe Web Browsing Executor
 *
 * Handles web search and page crawling tool calls.
 */
import { WebBrowsingApiName, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import {
  type WebBrowsingDocumentService,
  WebBrowsingExecutionRuntime,
} from '@lobechat/builtin-tool-web-browsing/executionRuntime';
import {
  type BuiltinToolContext,
  type BuiltinToolResult,
  type CrawlMultiPagesQuery,
  type SearchQuery,
} from '@lobechat/types';
import { BaseExecutor, SEARCH_SEARXNG_NOT_CONFIG } from '@lobechat/types';

import { agentDocumentService } from '@/services/agentDocument';
import { notebookService } from '@/services/notebook';
import { searchService } from '@/services/search';

const baseRuntime = new WebBrowsingExecutionRuntime({ searchService });

const createDocumentService = (ctx: BuiltinToolContext): WebBrowsingDocumentService | undefined => {
  if (!ctx.topicId && !ctx.agentId) return undefined;

  return {
    associateDocument: async (documentId) => {
      if (!ctx.agentId) return;

      await agentDocumentService.associateDocument({
        agentId: ctx.agentId,
        documentId,
      });
    },
    createDocument: async ({ content, description, title, url }) => {
      if (!ctx.topicId) throw new Error('topicId is required');

      return notebookService.createDocument({
        content,
        description: description || `Crawled from ${url}`,
        source: url,
        sourceType: 'web',
        title,
        topicId: ctx.topicId,
        type: 'article',
      });
    },
  };
};

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

      const result = await baseRuntime.search(params, { signal: ctx.signal });

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

      // Create a runtime with document service bound to this call's context
      const documentService = createDocumentService(ctx);
      const runtime = documentService
        ? new WebBrowsingExecutionRuntime({ documentService, searchService })
        : baseRuntime;

      const result = await runtime.crawlMultiPages(params);

      if (result.success) {
        return {
          content: result.content,
          state: result.state,
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
