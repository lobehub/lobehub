import { TRPCError } from '@trpc/server';
import { and, eq, inArray, ne, or } from 'drizzle-orm';

import {
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  documents,
  knowledgeBaseFiles,
  knowledgeBases,
  resourcePermissions,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  assertCanPerformResourceAction,
  type ResourceMeta,
} from '@/server/services/resourcePermission';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

interface KnowledgeBaseAccessCtx {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Assert the caller may browse a knowledge base's internal content (file
 * list, chunks, previews). Mounting/retrieval is NOT gated here — a
 * restricted KB (resource-permission `use` level) stays usable on agents.
 *
 * Personal mode passes through: the models' ownership filter already scopes
 * rows to the caller, and resource permissions only exist inside workspaces.
 */
export const assertKnowledgeBaseBrowsable = async (
  ctx: KnowledgeBaseAccessCtx,
  knowledgeBaseId: string,
  meta?: ResourceMeta,
): Promise<void> => {
  if (!ctx.workspaceId) return;

  await assertCanPerformResourceAction({
    action: 'view',
    db: ctx.serverDB,
    meta,
    resourceId: knowledgeBaseId,
    resourceType: 'knowledgeBase',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

/**
 * All knowledge bases in a workspace carrying an explicit `use`-level
 * (No-access) resource-permission row — caller-independent. Listings use it
 * to badge restricted KBs for managers; `getRestrictedKnowledgeBaseIds`
 * derives the caller-relative subset for filtering.
 */
export const getUseLevelKnowledgeBaseIds = async (
  db: LobeChatDatabase,
  workspaceId: string,
): Promise<string[]> => {
  const rows = await db
    .select({ id: resourcePermissions.resourceId })
    .from(resourcePermissions)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, resourcePermissions.resourceId))
    .where(
      and(
        eq(resourcePermissions.workspaceId, workspaceId),
        eq(resourcePermissions.resourceType, 'knowledgeBase'),
        eq(resourcePermissions.accessLevel, 'use'),
        // A permission row staged on a still-private KB is inert until the KB
        // is published — private KBs are creator-only regardless of the row.
        eq(knowledgeBases.visibility, 'public'),
      ),
    );

  return rows.map((row) => row.id);
};

/**
 * Knowledge bases in the caller's workspace whose file list the caller may
 * NOT browse: an explicit `use`-level resource-permission row, minus KBs the
 * caller created, and empty entirely for `KNOWLEDGE_BASE_UPDATE:all` curators
 * (workspace owners/admins).
 *
 * Used to drop restricted KBs (and their linked content) from listings —
 * restricted KBs are fully hidden from non-privileged members.
 */
export const getRestrictedKnowledgeBaseIds = async (
  ctx: KnowledgeBaseAccessCtx,
): Promise<string[]> => {
  if (!ctx.workspaceId) return [];

  const rows = await ctx.serverDB
    .select({ id: resourcePermissions.resourceId })
    .from(resourcePermissions)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, resourcePermissions.resourceId))
    .where(
      and(
        eq(resourcePermissions.workspaceId, ctx.workspaceId),
        eq(resourcePermissions.resourceType, 'knowledgeBase'),
        eq(resourcePermissions.accessLevel, 'use'),
        // A `use` row staged while the KB is still private must not leak into
        // member-facing filters: the private KB is already creator-only, and
        // filtering here would also hide its files from open KBs they share.
        eq(knowledgeBases.visibility, 'public'),
        // Creators always keep browsing their own knowledge bases.
        ne(knowledgeBases.userId, ctx.userId),
      ),
    );

  if (rows.length === 0) return [];

  const { hasAllScope } = await getWorkspaceScopedPermissionMatches({
    action: 'KNOWLEDGE_BASE_UPDATE',
    db: ctx.serverDB,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  if (hasAllScope) return [];

  return rows.map((row) => row.id);
};

/**
 * Assert a file-level read (chunk list, file item detail) does not leak a
 * restricted knowledge base's content. A file linked to any restricted KB is
 * blocked even when it also belongs to an open KB — over-hiding beats leaking
 * through a shared membership, and matches the listing filters.
 */
export const assertFileNotInRestrictedKnowledgeBase = async (
  ctx: KnowledgeBaseAccessCtx,
  fileId: string,
): Promise<void> => {
  if (!ctx.workspaceId) return;

  const memberships = await ctx.serverDB
    .select({ knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId })
    .from(knowledgeBaseFiles)
    .where(eq(knowledgeBaseFiles.fileId, fileId));
  if (memberships.length === 0) return;

  const restricted = await getRestrictedKnowledgeBaseIds(ctx);
  if (restricted.length === 0) return;

  const restrictedSet = new Set(restricted);
  if (memberships.some((m) => restrictedSet.has(m.knowledgeBaseId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only knowledge base managers can view this file',
    });
  }
};

/**
 * Assert the caller may attach (or re-enable) a knowledge base on an agent.
 * A restricted KB is invisible to non-privileged members, so attaching by a
 * known id must fail the same way — otherwise agent retrieval would resurrect
 * access the picker already denies. Detaching / disabling an already attached
 * row stays allowed and is deliberately not gated here.
 */
export const assertKnowledgeBaseAttachable = async (
  ctx: KnowledgeBaseAccessCtx,
  knowledgeBaseId: string,
): Promise<void> => {
  if (!ctx.workspaceId) return;

  const restricted = await getRestrictedKnowledgeBaseIds(ctx);
  if (restricted.includes(knowledgeBaseId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only knowledge base managers can attach this knowledge base',
    });
  }
};

/**
 * Assert a full-content batch read (`chunk.getFileContents`) does not leak a
 * restricted knowledge base's content. Accepts the mixed id list the endpoint
 * takes: `file_*` ids resolve through `knowledge_base_files`, `docs_*` ids
 * through `documents.knowledge_base_id`. The member-facing "No access" level
 * only promises attached agents continued retrieval (semantic search) — full
 * document dumps stay manager-only, matching the browse restriction.
 */
export const assertContentsNotInRestrictedKnowledgeBase = async (
  ctx: KnowledgeBaseAccessCtx,
  ids: string[],
): Promise<void> => {
  if (!ctx.workspaceId || ids.length === 0) return;

  const restricted = await getRestrictedKnowledgeBaseIds(ctx);
  if (restricted.length === 0) return;

  const documentIds = ids.filter((id) => id.startsWith('docs_'));
  const fileIds = ids.filter((id) => !id.startsWith('docs_'));

  if (fileIds.length > 0) {
    const rows = await ctx.serverDB
      .select({ fileId: knowledgeBaseFiles.fileId })
      .from(knowledgeBaseFiles)
      .where(
        and(
          inArray(knowledgeBaseFiles.fileId, fileIds),
          inArray(knowledgeBaseFiles.knowledgeBaseId, restricted),
        ),
      )
      .limit(1);
    if (rows.length > 0) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only knowledge base managers can view this file',
      });
    }
  }

  if (documentIds.length > 0) {
    const rows = await ctx.serverDB
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(inArray(documents.id, documentIds), inArray(documents.knowledgeBaseId, restricted)),
      )
      .limit(1);
    if (rows.length > 0) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only knowledge base managers can view this document',
      });
    }
  }
};

/**
 * Filter caller-supplied knowledge-base ids for retrieval (semantic search /
 * BM25). A restricted KB stays retrievable only through the attached-agent
 * carve-out: it must have at least one enabled `agents_knowledge_bases` row.
 * Restricted KBs without such a row are silently dropped — a member could not
 * reach their content through any agent either, so returning chunks for a
 * handcrafted id would widen access beyond the policy.
 */
export const filterRetrievableKnowledgeBaseIds = async (
  ctx: KnowledgeBaseAccessCtx,
  knowledgeIds: string[],
): Promise<string[]> => {
  if (!ctx.workspaceId || knowledgeIds.length === 0) return knowledgeIds;

  const restricted = await getRestrictedKnowledgeBaseIds(ctx);
  if (restricted.length === 0) return knowledgeIds;

  const restrictedSet = new Set(restricted);
  const restrictedRequested = knowledgeIds.filter((id) => restrictedSet.has(id));
  if (restrictedRequested.length === 0) return knowledgeIds;

  const attachedRows = await ctx.serverDB
    .select({ id: agentsKnowledgeBases.knowledgeBaseId })
    .from(agentsKnowledgeBases)
    .innerJoin(agents, eq(agents.id, agentsKnowledgeBases.agentId))
    .where(
      and(
        inArray(agentsKnowledgeBases.knowledgeBaseId, restrictedRequested),
        eq(agentsKnowledgeBases.enabled, true),
        // The carve-out only counts attachments the caller can actually reach:
        // a KB enabled solely on someone else's private agent must not open
        // retrieval for the whole workspace.
        or(eq(agents.visibility, 'public'), eq(agents.userId, ctx.userId)),
      ),
    );
  const attached = new Set(attachedRows.map((row) => row.id));

  return knowledgeIds.filter((id) => !restrictedSet.has(id) || attached.has(id));
};

/**
 * Filter caller-supplied file ids for retrieval (vector search). A file
 * linked to a restricted KB stays retrievable only when it is also directly
 * attached (enabled) to an agent the caller can reach — the same carve-out
 * `filterRetrievableKnowledgeBaseIds` applies at the KB level.
 */
export const filterRetrievableFileIds = async (
  ctx: KnowledgeBaseAccessCtx,
  fileIds: string[],
): Promise<string[]> => {
  if (!ctx.workspaceId || fileIds.length === 0) return fileIds;

  const restricted = await getRestrictedKnowledgeBaseIds(ctx);
  if (restricted.length === 0) return fileIds;

  const restrictedMemberships = await ctx.serverDB
    .select({ fileId: knowledgeBaseFiles.fileId })
    .from(knowledgeBaseFiles)
    .where(
      and(
        inArray(knowledgeBaseFiles.fileId, fileIds),
        inArray(knowledgeBaseFiles.knowledgeBaseId, restricted),
      ),
    );
  const restrictedFiles = new Set(restrictedMemberships.map((row) => row.fileId));
  if (restrictedFiles.size === 0) return fileIds;

  const attachedRows = await ctx.serverDB
    .select({ fileId: agentsFiles.fileId })
    .from(agentsFiles)
    .innerJoin(agents, eq(agents.id, agentsFiles.agentId))
    .where(
      and(
        inArray(agentsFiles.fileId, [...restrictedFiles]),
        eq(agentsFiles.enabled, true),
        or(eq(agents.visibility, 'public'), eq(agents.userId, ctx.userId)),
      ),
    );
  const attached = new Set(attachedRows.map((row) => row.fileId));

  return fileIds.filter((id) => !restrictedFiles.has(id) || attached.has(id));
};

/**
 * Convenience filter for KB list queries: strips restricted knowledge bases
 * from an already-fetched list.
 */
export const filterRestrictedKnowledgeBases = async <T extends { id: string }>(
  ctx: KnowledgeBaseAccessCtx,
  items: T[],
): Promise<T[]> => {
  if (!ctx.workspaceId || items.length === 0) return items;

  const restricted = await getRestrictedKnowledgeBaseIds(ctx);
  if (restricted.length === 0) return items;

  const restrictedSet = new Set(restricted);
  return items.filter((item) => !restrictedSet.has(item.id));
};

export type { KnowledgeBaseAccessCtx };
