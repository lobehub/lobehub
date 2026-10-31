import { type DocumentAccessScope, stripAgentShareDocumentProvenance } from '@lobechat/types';
import { and, eq, exists } from 'drizzle-orm';

import { agentDocuments, documents } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { documentMatchesAccessScope } from '../../../utils/documentVisibility';
import { buildWorkspaceWhere } from '../../../utils/workspace';

/**
 * The scope every `AgentDocumentModel` helper runs in, passed as the first
 * argument instead of `this` so the helper modules never import the class.
 */
export interface AgentDocumentContext {
  db: LobeChatDatabase;
  documentAccessScope: DocumentAccessScope;
  userId: string;
  workspaceId?: string;
}

/**
 * Workspace-aware ownership predicate for the `agent_documents` binding table.
 * Personal mode → `user_id = ? AND workspace_id IS NULL`; workspace mode → `workspace_id = ?`.
 */
export function agentDocOwnership(ctx: AgentDocumentContext) {
  // NOTICE:
  // For now, we expect a caller authorized to access an agent to access all resources
  // bound under its agent documents, including backing files, without a separate
  // Resources publish step. Tool reads and UI previews need the same access contract.
  // Agent documents and backing files use separate visibility checks; uploads without
  // the agent-document source can expose a document in tools/the tree while its
  // original-file preview returns 404. Dedicated uploads now default to public.
  // Context: AgentDocumentsService.importFile and FileDocumentPreview; this predicate
  // scopes bindings but does not itself authorize access to the agent.
  // Replace this interim assumption when a consistent workspace authorization model
  // covers agent documents, backing files, tool execution, and resource publishing.

  // REVIEW: A private upload must not silently become readable merely because someone
  // can access its agent. Restricting preview or even one read tool is insufficient:
  // if an agent can read private content through another path or its existing context,
  // a user can prompt it to copy or summarize that content into a shared knowledge base
  // and leak it. The current assumption does not provide per-resource confidentiality.

  // TODO: Revisit this coarse model before extending workspace permission controls.
  // Define how sharing is authorized and how reads, execution context, and writes to
  // broader audiences are constrained; enforce the resulting rules across all paths.
  return and(
    buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, agentDocuments),
    exists(
      ctx.db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, agentDocuments.documentId),
            documentMatchesAccessScope(documents.metadata, ctx.documentAccessScope),
          ),
        ),
    ),
  );
}

/** Workspace-aware ownership predicate for the backing `documents` rows. */
export function documentOwnership(ctx: AgentDocumentContext) {
  return and(
    buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, documents),
    documentMatchesAccessScope(documents.metadata, ctx.documentAccessScope),
  );
}

export function scopeMetadata(
  ctx: AgentDocumentContext,
  metadata?: Record<string, any>,
): Record<string, any> | undefined {
  const sanitizedMetadata = stripAgentShareDocumentProvenance(metadata);
  if (ctx.documentAccessScope.type !== 'agentShare') return sanitizedMetadata;

  return {
    ...sanitizedMetadata,
    agentShare: {
      shareId: ctx.documentAccessScope.shareId,
      topicId: ctx.documentAccessScope.topicId,
      visitorUserId: ctx.documentAccessScope.visitorUserId,
    },
  };
}
