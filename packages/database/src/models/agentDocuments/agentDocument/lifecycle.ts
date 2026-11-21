import { and, eq, inArray, isNull, notExists } from 'drizzle-orm';

import { agentDocuments, documents } from '../../../schemas';
import type { Transaction } from '../../../type';
import { PolicyLoad } from '../types';
import { agentDocOwnership, type AgentDocumentContext, documentOwnership } from './context';
import { findByIdWithOptions } from './queries';
import { listSubtreeByDocumentId } from './tree';

export async function deleteDocument(
  ctx: AgentDocumentContext,
  documentId: string,
  deleteReason?: string,
): Promise<void> {
  // Soft delete only: mark deleted metadata and stop autoload.
  // We intentionally keep both agent_documents row and linked documents row for recovery.
  await ctx.db
    .update(agentDocuments)
    .set({
      policyLoad: PolicyLoad.DISABLED,
      deleteReason,
      deletedAt: new Date(),
      deletedByAgentId: null,
      deletedByUserId: ctx.userId,
    })
    .where(
      and(
        eq(agentDocuments.id, documentId),
        agentDocOwnership(ctx),
        isNull(agentDocuments.deletedAt),
      ),
    );
}

export async function deleteSubtreeByDocumentId(
  ctx: AgentDocumentContext,
  agentId: string,
  rootDocumentId: string,
  deleteReason?: string,
): Promise<void> {
  const subtree = await listSubtreeByDocumentId(ctx, agentId, rootDocumentId);

  if (subtree.length === 0) return;

  await ctx.db
    .update(agentDocuments)
    .set({
      policyLoad: PolicyLoad.DISABLED,
      deleteReason,
      deletedAt: new Date(),
      deletedByAgentId: null,
      deletedByUserId: ctx.userId,
    })
    .where(
      and(
        agentDocOwnership(ctx),
        inArray(
          agentDocuments.id,
          subtree.map((item) => item.id),
        ),
        isNull(agentDocuments.deletedAt),
      ),
    );
}

/**
 * Restores a soft-deleted agent document binding to the live tree.
 *
 * Use when:
 * - Moving a deleted document back into active VFS visibility.
 * - Preserving the existing document row and agent document id.
 *
 * Expects:
 * - `documentId` may refer to a deleted binding owned by the current user.
 * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately.
 *
 * Returns:
 * - Nothing; missing bindings are ignored.
 *
 */
export async function restore(ctx: AgentDocumentContext, documentId: string): Promise<void> {
  const existing = await findByIdWithOptions(ctx, documentId, { includeDeleted: true });

  if (!existing) return;

  await ctx.db
    .update(agentDocuments)
    .set({
      deleteReason: null,
      deletedAt: null,
      deletedByAgentId: null,
      deletedByUserId: null,
      policyLoad: PolicyLoad.PROGRESSIVE,
    })
    .where(and(eq(agentDocuments.id, documentId), agentDocOwnership(ctx)));
}

export async function restoreSubtreeByDocumentId(
  ctx: AgentDocumentContext,
  agentId: string,
  rootDocumentId: string,
): Promise<void> {
  const subtree = await listSubtreeByDocumentId(ctx, agentId, rootDocumentId, {
    includeDeleted: true,
  });

  if (subtree.length === 0) return;

  await ctx.db
    .update(agentDocuments)
    .set({
      deleteReason: null,
      deletedAt: null,
      deletedByAgentId: null,
      deletedByUserId: null,
      policyLoad: PolicyLoad.PROGRESSIVE,
    })
    .where(
      and(
        agentDocOwnership(ctx),
        inArray(
          agentDocuments.id,
          subtree.map((item) => item.id),
        ),
      ),
    );
}

/**
 * Hard-deletes agent document bindings by binding id.
 *
 * Use when:
 * - `AgentDocumentRepository` permanently deletes trash entries and then removes
 *   the backing documents no other binding still references.
 *
 * Expects:
 * - `trx` is the caller-owned transaction; this helper writes only `agent_documents`.
 */
export async function deleteBindings(
  ctx: AgentDocumentContext,
  trx: Transaction,
  agentDocumentIds: string[],
): Promise<void> {
  await trx
    .delete(agentDocuments)
    .where(and(agentDocOwnership(ctx), inArray(agentDocuments.id, agentDocumentIds)));
}

/**
 * Removes only documents with no surviving agent binding and returns their backing files.
 *
 * Expects:
 * - `trx` is the caller-owned transaction; this helper writes only `documents`.
 */
export async function deleteUnboundDocuments(
  ctx: AgentDocumentContext,
  trx: Transaction,
  documentIds: string[],
): Promise<string[]> {
  // Serialize deletion with concurrent binding FK inserts before inspecting surviving owners.
  await trx
    .select({ id: documents.id })
    .from(documents)
    .where(and(documentOwnership(ctx), inArray(documents.id, documentIds)))
    .orderBy(documents.id)
    .for('update');
  // Removing one agent's binding must not cascade through another agent's shared document.
  const removed = await trx
    .delete(documents)
    .where(
      and(
        documentOwnership(ctx),
        inArray(documents.id, documentIds),
        notExists(
          trx
            .select({ id: agentDocuments.id })
            .from(agentDocuments)
            .where(eq(agentDocuments.documentId, documents.id)),
        ),
      ),
    )
    .returning({ fileId: documents.fileId });

  return [...new Set(removed.flatMap(({ fileId }) => (fileId ? [fileId] : [])))];
}

export async function deleteByAgent(
  ctx: AgentDocumentContext,
  agentId: string,
  deleteReason?: string,
): Promise<void> {
  await ctx.db
    .update(agentDocuments)
    .set({
      policyLoad: PolicyLoad.DISABLED,
      deleteReason,
      deletedAt: new Date(),
      // NOTICE: mark for telling everyone that this should not ever marked as user id, no matter what circumstances
      deletedByAgentId: agentId,
      deletedByUserId: null,
    })
    .where(
      and(
        eq(agentDocuments.agentId, agentId),
        agentDocOwnership(ctx),
        isNull(agentDocuments.deletedAt),
      ),
    );
}

export async function deleteByTemplate(
  ctx: AgentDocumentContext,
  agentId: string,
  templateId: string,
  deleteReason?: string,
): Promise<void> {
  await ctx.db
    .update(agentDocuments)
    .set({
      policyLoad: PolicyLoad.DISABLED,
      deleteReason,
      deletedAt: new Date(),
      deletedByAgentId: null,
      deletedByUserId: ctx.userId,
    })
    .where(
      and(
        eq(agentDocuments.agentId, agentId),
        eq(agentDocuments.templateId, templateId),
        agentDocOwnership(ctx),
        isNull(agentDocuments.deletedAt),
      ),
    );
}
