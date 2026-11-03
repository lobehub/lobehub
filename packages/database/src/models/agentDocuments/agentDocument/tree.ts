import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { agentDocuments, documents } from '../../../schemas';
import { nonNull } from '../../utils/rows';
import type { AgentDocument } from '../types';
import { agentDocOwnership, type AgentDocumentContext } from './context';
import { findByDocumentId } from './queries';
import type { AgentDocumentQueryOptions } from './types';
import { buildDeletedAtFilters, normalizeListOffset, toAgentDocument } from './utils';

export async function listByParentIds(
  ctx: AgentDocumentContext,
  agentId: string,
  parentIds: string[],
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument[]> {
  /* v8 ignore next -- unreachable: the only caller (listSubtreeByDocumentId) loops while pendingParentIds is non-empty */
  if (parentIds.length === 0) return [];

  const results = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        inArray(documents.parentId, parentIds),
        ...buildDeletedAtFilters(options),
      ),
    )
    .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id));

  return results.map(({ settings, doc }) => toAgentDocument(settings, doc));
}

/**
 * Counts live children per parent `documentId`, for listings that show which
 * entries (folders or documents) have something nested under them. Omit
 * `parentIds` to count every parent of the agent in one grouped query.
 * Parents without children are absent from the map.
 */
export async function countChildrenByParentIds(
  ctx: AgentDocumentContext,
  agentId: string,
  parentIds?: string[],
): Promise<Map<string, number>> {
  if (parentIds?.length === 0) return new Map();

  const rows = await ctx.db
    .select({ count: sql<number>`count(*)::int`, parentId: documents.parentId })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        parentIds ? inArray(documents.parentId, parentIds) : isNotNull(documents.parentId),
        isNull(agentDocuments.deletedAt),
      ),
    )
    .groupBy(documents.parentId);

  return new Map(
    // The WHERE clause (inArray / isNotNull on parent_id) never yields a NULL parent.
    rows.map((row) => [nonNull(row.parentId, 'documents.parent_id'), Number(row.count)] as const),
  );
}

export async function findByParentAndFilename(
  ctx: AgentDocumentContext,
  agentId: string,
  parentId: string | null,
  filename: string,
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument | undefined> {
  const [result] = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        eq(documents.filename, filename),
        parentId ? eq(documents.parentId, parentId) : isNull(documents.parentId),
        ...buildDeletedAtFilters(options),
      ),
    )
    .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id))
    .limit(1);

  if (!result) return undefined;

  return toAgentDocument(result.settings, result.doc);
}

/**
 * Lists agent document bindings that share one tree segment.
 *
 * Use when:
 * - VFS callers need to choose the visible entry for a path segment
 * - Migration checks need to detect duplicate `parentId + filename` rows
 *
 * Expects:
 * - `parentId` is the canonical document row parent id, not the agent document id
 *
 * Returns:
 * - Matching bindings ordered oldest first so duplicate filename resolution is deterministic
 */
export async function listByParentAndFilename(
  ctx: AgentDocumentContext,
  agentId: string,
  parentId: string | null,
  filename: string,
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument[]> {
  const results = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        eq(documents.filename, filename),
        parentId ? eq(documents.parentId, parentId) : isNull(documents.parentId),
        ...buildDeletedAtFilters(options),
      ),
    )
    .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id))
    .limit(options?.limit ?? 9999)
    .offset(normalizeListOffset(options?.cursor));

  return results.map(({ settings, doc }) => toAgentDocument(settings, doc));
}

export async function listByParent(
  ctx: AgentDocumentContext,
  agentId: string,
  parentId: string | null,
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument[]> {
  const results = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        parentId ? eq(documents.parentId, parentId) : isNull(documents.parentId),
        ...buildDeletedAtFilters(options),
      ),
    )
    .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id))
    .limit(options?.limit ?? 9999)
    .offset(normalizeListOffset(options?.cursor));

  return results.map(({ settings, doc }) => toAgentDocument(settings, doc));
}

export async function listSubtreeByDocumentId(
  ctx: AgentDocumentContext,
  agentId: string,
  rootDocumentId: string,
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument[]> {
  const root = await findByDocumentId(ctx, agentId, rootDocumentId, options);

  if (!root) return [];

  const subtree = [root];
  const pendingParentIds = [root.documentId];

  while (pendingParentIds.length > 0) {
    const parentIds = pendingParentIds.splice(0, pendingParentIds.length);
    const children = await listByParentIds(ctx, agentId, parentIds, options);

    for (const child of children) {
      subtree.push(child);
      pendingParentIds.push(child.documentId);
    }
  }

  return subtree;
}
