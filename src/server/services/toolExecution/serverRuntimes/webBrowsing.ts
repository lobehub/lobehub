import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';

import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { SearchService } from '@/server/services/search';
import { WebBrowsingDocumentService } from '@/server/services/webBrowsing';

import { type ServerRuntimeRegistration } from './types';

export const webBrowsingRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { userId, serverDB, agentId } = context;
    const canSaveDocuments = userId && serverDB && agentId;

    return new WebBrowsingExecutionRuntime({
      documentService: canSaveDocuments
        ? {
            associateDocument: async (documentId) => {
              const service = new AgentDocumentsService(serverDB, userId);
              await service.associateDocument(agentId, documentId);
            },
            createDocument: async (params) => {
              // Same service the client trpc procedure uses — dedupe by URL,
              // short-circuit on byte-identical content, write a history
              // snapshot when content actually changed (LOBE-9384).
              const service = new WebBrowsingDocumentService(serverDB, userId);
              return service.upsertCrawledDocument(params);
            },
          }
        : undefined,
      searchService: new SearchService(),
    });
  },
  identifier: WebBrowsingManifest.identifier,
};
