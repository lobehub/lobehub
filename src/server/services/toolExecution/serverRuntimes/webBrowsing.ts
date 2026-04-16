import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';
import { type CrawlMultiPagesQuery, type CrawlPluginState } from '@lobechat/types';
import { type CrawlSuccessResult } from '@lobechat/web-crawler';

import { DocumentModel } from '@/database/models/document';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { SearchService } from '@/server/services/search';

import { type ServerRuntimeRegistration } from './types';

/**
 * WebBrowsing Server Runtime
 * Per-request factory to support saving crawled content to agent documents
 */
export const webBrowsingRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const baseRuntime = new WebBrowsingExecutionRuntime({
      searchService: new SearchService(),
    });

    // If we have userId, serverDB, and agentId, wrap crawl methods to save to agent documents
    if (context.userId && context.serverDB && context.agentId) {
      const agentDocumentsService = new AgentDocumentsService(context.serverDB, context.userId);
      const documentModel = new DocumentModel(context.serverDB, context.userId);
      const agentId = context.agentId;

      const originalCrawlMultiPages = baseRuntime.crawlMultiPages.bind(baseRuntime);

      baseRuntime.crawlMultiPages = async (params: CrawlMultiPagesQuery) => {
        const result = await originalCrawlMultiPages(params);

        if (result.success) {
          const crawlState = result.state as CrawlPluginState;

          await Promise.all(
            crawlState.results.map(async (crawlResult) => {
              if ('errorMessage' in crawlResult.data) return;

              const pageData = crawlResult.data as CrawlSuccessResult;
              if (!pageData.content) return;

              try {
                // Create document in documents table
                const doc = await documentModel.create({
                  content: pageData.content,
                  description: pageData.description || `Crawled from ${pageData.url}`,
                  fileType: 'article',
                  filename: pageData.title || pageData.url,
                  source: pageData.url,
                  sourceType: 'web',
                  title: pageData.title || pageData.url,
                  totalCharCount: pageData.content.length,
                  totalLineCount: pageData.content.split('\n').length,
                });

                // Associate with agent
                await agentDocumentsService.associateDocument(agentId, doc.id);
              } catch {
                // Silently ignore document creation errors to not block the main flow
              }
            }),
          );
        }

        return result;
      };
    }

    return baseRuntime;
  },
  identifier: WebBrowsingManifest.identifier,
};
