import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';

import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { SearchService } from '@/server/services/search';
import { getUserWebBrowsingConfig } from '@/server/services/search/userChannels';
import { WebBrowsingDocumentService } from '@/server/services/webBrowsing';

import { type ServerRuntimeRegistration } from './types';

export const webBrowsingRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const { userId, serverDB, agentId, agentVisibility } = context;
    const canSaveDocuments = userId && serverDB && agentId;

    // Seed the search service with the caller's ordered channel preferences.
    // Only reachable when both userId and serverDB are present; otherwise the
    // service falls back to the server default channel order.
    const userChannels =
      userId && serverDB ? await getUserWebBrowsingConfig(serverDB, userId) : undefined;

    return new WebBrowsingExecutionRuntime({
      documentService: canSaveDocuments
        ? {
            associateDocument: async (documentId) => {
              const service = new AgentDocumentsService(
                serverDB,
                userId,
                context.workspaceId,
                agentVisibility,
              );
              await service.associateDocument(agentId, documentId);
            },
            createDocument: async (params) => {
              // Same service the client trpc procedure uses — dedupe by URL,
              // short-circuit on byte-identical content, write a history
              // snapshot when content actually changed (). Threading
              // agentVisibility so private-agent crawls land in the caller's
              // private Pages bucket.
              const service = new WebBrowsingDocumentService(
                serverDB,
                userId,
                context.workspaceId,
                agentVisibility,
              );
              return service.upsertCrawledDocument(params);
            },
          }
        : undefined,
      searchService: new SearchService({ userChannels }),
    });
  },
  identifier: WebBrowsingManifest.identifier,
};
