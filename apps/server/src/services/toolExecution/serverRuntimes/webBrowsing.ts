import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';

import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { SearchService } from '@/server/services/search';
import { WebBrowsingDocumentService } from '@/server/services/webBrowsing';

import { type ServerRuntimeRegistration } from './types';

export const webBrowsingRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { principal, serverDB, agentId, agentVisibility } = context;
    // Everything persisted here lands in the RESOURCE OWNER's Pages library.
    const userId = principal.resourceOwnerUserId;
    // A share visitor's run executes with the CREATOR's own credentials
    // (`principal.resourceOwnerUserId` is the creator — see `AgentShareGate`), so without
    // this guard `crawlSinglePage`/`crawlMultiPages` would unconditionally
    // persist every crawled page as a new `documents` row (and associate it
    // to the shared agent) regardless of what the share actually grants.
    // `lobe-web-browsing` has no `DATA_TOOL_ACCESS_RULES` entry — it isn't
    // gated by `filePermissionConfig` at all — and v1 share grants are
    // `none`/`read` only, so there is no write grant that could authorize
    // this persistence. Disable it for share runs instead: `search` and
    // `crawlSinglePage`/`crawlMultiPages` still return the page content
    // inline in the tool result either way, so the visitor loses nothing
    // except the creator's Pages library silently accumulating
    // visitor-triggered, attacker-URL-titled documents.
    const canSaveDocuments = userId && serverDB && agentId && !principal.delegation;

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
      searchService: new SearchService(),
    });
  },
  identifier: WebBrowsingManifest.identifier,
};
