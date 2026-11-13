import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import pMap from 'p-map';

import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import {
  agentsKnowledgeBases,
  documents,
  knowledgeBaseFiles,
  knowledgeBases,
  projectKnowledgeBases,
  resourcePermissions,
  tasks,
  workspaceMembers,
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
        // Workspace-wide rows only: a per-member collaborator grant grades one
        // member, and must never mark the knowledge base itself as restricted.
        isNull(resourcePermissions.userId),
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
        // Workspace-wide rows only — see `getUseLevelKnowledgeBaseIds`.
        isNull(resourcePermissions.userId),
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

  // A collaborator grant at `edit` lifts the caller back to browsable on that
  // knowledge base — drop it from the restricted set so every listing/search
  // filter downstream lets it through, mirroring `canPerformResourceAction`.
  const grantedIds = await new ResourcePermissionModel(
    ctx.serverDB,
    ctx.workspaceId,
  ).getCollaboratorResourceIds('knowledgeBase', ctx.userId, 'edit');
  const grantedSet = new Set(grantedIds);

  return rows.map((row) => row.id).filter((id) => !grantedSet.has(id));
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

/** Picks, from the caller's restricted knowledge base ids, the ones a read may still use. */
export type UsableKnowledgeBaseResolver = (restrictedIds: string[]) => Promise<string[]>;

/**
 * Of `knowledgeBaseIds`, the ones mounted on the agent (or on its project,
 * directly or through the task) by a user who may browse them.
 *
 * "No access" keeps a knowledge base usable on the agents it is mounted on, so
 * an agent may read its full content for a member who cannot browse it. The
 * mount must come from someone who can browse the knowledge base (its
 * creator, a curator or a collaborator): a member mounting a knowledge base
 * they cannot browse on their own agent must not unlock it.
 */
export const getKnowledgeBaseIdsMountedByBrowsers = async (
  ctx: Pick<KnowledgeBaseAccessCtx, 'serverDB' | 'workspaceId'>,
  scope: { agentId?: string; projectId?: string; taskId?: string },
  knowledgeBaseIds: string[],
): Promise<string[]> => {
  const { serverDB: db, workspaceId } = ctx;
  if (!workspaceId || knowledgeBaseIds.length === 0) return [];

  let projectId = scope.projectId;
  if (!projectId && scope.taskId) {
    const [task] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, scope.taskId), eq(tasks.workspaceId, workspaceId)))
      .limit(1);
    projectId = task?.projectId ?? undefined;
  }

  const [agentMounts, projectMounts] = await Promise.all([
    scope.agentId
      ? db
          .select({
            knowledgeBaseId: agentsKnowledgeBases.knowledgeBaseId,
            mountedBy: agentsKnowledgeBases.userId,
          })
          .from(agentsKnowledgeBases)
          .where(
            and(
              eq(agentsKnowledgeBases.agentId, scope.agentId),
              eq(agentsKnowledgeBases.workspaceId, workspaceId),
              eq(agentsKnowledgeBases.enabled, true),
              inArray(agentsKnowledgeBases.knowledgeBaseId, knowledgeBaseIds),
            ),
          )
      : [],
    projectId
      ? db
          .select({
            knowledgeBaseId: projectKnowledgeBases.knowledgeBaseId,
            mountedBy: projectKnowledgeBases.addedByUserId,
          })
          .from(projectKnowledgeBases)
          .where(
            and(
              eq(projectKnowledgeBases.projectId, projectId),
              eq(projectKnowledgeBases.workspaceId, workspaceId),
              eq(projectKnowledgeBases.enabled, true),
              inArray(projectKnowledgeBases.knowledgeBaseId, knowledgeBaseIds),
            ),
          )
      : [],
  ]);

  const mounts = [...agentMounts, ...projectMounts];
  const mountAuthors = [
    ...new Set(mounts.flatMap(({ mountedBy }) => (mountedBy ? [mountedBy] : []))),
  ];
  if (mountAuthors.length === 0) return [];

  // Only current members vouch for a mount: a removed member keeps their rows
  // (membership is soft-deleted) and, as a creator, would otherwise still pass
  // the creator exemption in `getRestrictedKnowledgeBaseIds`.
  const activeMembers = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.userId, mountAuthors),
        isNull(workspaceMembers.deletedAt),
      ),
    );
  const mounters = activeMembers.map(({ userId }) => userId);
  const restrictedByMounter = new Map(
    await pMap(
      mounters,
      async (userId) =>
        [
          userId,
          new Set(await getRestrictedKnowledgeBaseIds({ serverDB: db, userId, workspaceId })),
        ] as const,
      { concurrency: 5 },
    ),
  );

  return [
    ...new Set(
      mounts
        .filter(
          ({ knowledgeBaseId, mountedBy }) =>
            !!mountedBy &&
            restrictedByMounter.has(mountedBy) &&
            !restrictedByMounter.get(mountedBy)!.has(knowledgeBaseId),
        )
        .map(({ knowledgeBaseId }) => knowledgeBaseId),
    ),
  ];
};

/**
 * Assert a full-content batch read (`chunk.getFileContents`) does not leak a
 * restricted knowledge base's content. Accepts the mixed id list the endpoint
 * takes: `file_*` ids resolve through `knowledge_base_files`, `docs_*` ids
 * through `documents.knowledge_base_id`. The member-facing "No access" level
 * keeps the knowledge base usable by the agents it is mounted on — direct
 * document dumps stay manager-only, matching the browse restriction.
 *
 * `resolveUsableKnowledgeBaseIds` lets an agent tool read exempt the restricted
 * knowledge bases mounted on the running agent (see
 * `getKnowledgeBaseIdsMountedByBrowsers`). It only runs when the caller has
 * restricted knowledge bases. A file that is also in another restricted
 * knowledge base stays blocked.
 */
export const assertContentsNotInRestrictedKnowledgeBase = async (
  ctx: KnowledgeBaseAccessCtx,
  ids: string[],
  options: { resolveUsableKnowledgeBaseIds?: UsableKnowledgeBaseResolver } = {},
): Promise<void> => {
  if (!ctx.workspaceId || ids.length === 0) return;

  let restricted = await getRestrictedKnowledgeBaseIds(ctx);
  if (restricted.length > 0 && options.resolveUsableKnowledgeBaseIds) {
    const usable = new Set(await options.resolveUsableKnowledgeBaseIds(restricted));
    restricted = restricted.filter((id) => !usable.has(id));
  }
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
    // Inline pages carry `knowledgeBaseId` directly; parsed-file documents
    // leave it null and are linked through `fileId` → `knowledge_base_files`,
    // so both membership routes must be checked.
    const rows = await ctx.serverDB
      .select({ id: documents.id })
      .from(documents)
      .leftJoin(knowledgeBaseFiles, eq(documents.fileId, knowledgeBaseFiles.fileId))
      .where(
        and(
          inArray(documents.id, documentIds),
          or(
            inArray(documents.knowledgeBaseId, restricted),
            inArray(knowledgeBaseFiles.knowledgeBaseId, restricted),
          ),
        ),
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
