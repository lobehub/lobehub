import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';

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
    const { userId, serverDB, agentId } = context;

    return new WebBrowsingExecutionRuntime({
      onCrawlComplete:
        userId && serverDB && agentId
          ? async (results) => {
              const documentModel = new DocumentModel(serverDB, userId);
              const agentDocumentsService = new AgentDocumentsService(serverDB, userId);

              await Promise.all(
                results.map(async (pageData) => {
                  const doc = await documentModel.create({
                    content: pageData.content || '',
                    description: pageData.description || `Crawled from ${pageData.url}`,
                    fileType: 'article',
                    filename: pageData.title || pageData.url,
                    source: pageData.url,
                    sourceType: 'web',
                    title: pageData.title || pageData.url,
                    totalCharCount: pageData.content?.length || 0,
                    totalLineCount: pageData.content?.split('\n').length || 0,
                  });

                  await agentDocumentsService.associateDocument(agentId, doc.id);
                }),
              );
            }
          : undefined,
      searchService: new SearchService(),
    });
  },
  identifier: WebBrowsingManifest.identifier,
};
