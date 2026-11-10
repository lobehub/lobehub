import { INBOX_SESSION_ID } from '@lobechat/const';
import { and, eq, exists, inArray, isNull, or, type SQL } from 'drizzle-orm';

import { agents, type TopicItem, topics } from '../../schemas';
import {
  isTrashed,
  restoreStamp,
  type SoftDeleteOptions,
  trashStamp,
} from '../../utils/softDelete';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { TopicModelContext } from './context';

/**
 * Move topics to the recycle bin: stamp `deleted_at` and return the rows so
 * the caller can register them. Rows already trashed are left untouched (their
 * own registry row keeps their original stamp). Messages / threads are not
 * stamped — they are hidden by their parent and hard-cascade at purge time.
 */
export const softDelete = async (
  ctx: TopicModelContext,
  ids: string[],
  options: SoftDeleteOptions,
): Promise<TopicItem[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .update(topics)
    .set(trashStamp(options.deletedAt))
    .where(
      and(
        inArray(topics.id, ids),
        options.restrictToCreator ? ctx.mine() : ctx.ownership(),
        ctx.notShareVisitor(),
      ),
    )
    .returning();
};

/** Soft-delete counterpart of `batchDeleteBySessionId` (`sessionId` null = the agent's default session). */
export const softDeleteBySessionId = async (
  ctx: TopicModelContext,
  sessionId: string | null | undefined,
  options: SoftDeleteOptions,
): Promise<TopicItem[]> => {
  return ctx.db
    .update(topics)
    .set(trashStamp(options.deletedAt))
    .where(
      and(
        ctx.matchSession(sessionId),
        options.restrictToCreator ? ctx.mine() : ctx.ownership(),
        ctx.notShareVisitor(),
      ),
    )
    .returning();
};

export const softDeleteByGroupId = async (
  ctx: TopicModelContext,
  groupId: string | null | undefined,
  options: SoftDeleteOptions,
): Promise<TopicItem[]> => {
  return ctx.db
    .update(topics)
    .set(trashStamp(options.deletedAt))
    .where(
      and(
        ctx.matchGroup(groupId),
        options.restrictToCreator ? ctx.mine() : ctx.ownership(),
        ctx.notShareVisitor(),
      ),
    )
    .returning();
};

export const softDeleteByAgentId = async (
  ctx: TopicModelContext,
  agentId: string,
  options: SoftDeleteOptions & { legacySessionId?: string | null },
): Promise<TopicItem[]> => {
  return ctx.db
    .update(topics)
    .set(trashStamp(options.deletedAt))
    .where(
      and(
        or(
          eq(topics.agentId, agentId),
          options.legacySessionId
            ? and(isNull(topics.agentId), eq(topics.sessionId, options.legacySessionId))
            : undefined,
          // Include unassigned Inbox history immediately; bulk deletion must
          // not rely on a successful prior list-triggered migration.
          and(
            isNull(topics.agentId),
            isNull(topics.sessionId),
            isNull(topics.groupId),
            exists(
              ctx.db
                .select({ id: agents.id })
                .from(agents)
                .where(
                  and(
                    eq(agents.id, agentId),
                    eq(agents.slug, INBOX_SESSION_ID),
                    buildWorkspaceWhere(
                      { userId: ctx.userId, workspaceId: ctx.workspaceId },
                      agents,
                    ),
                  ),
                ),
            ),
          ),
        ),
        options.restrictToCreator ? ctx.mine() : ctx.ownership(),
        ctx.notShareVisitor(),
      ),
    )
    .returning();
};

/**
 * Cascade helper for trashing an agent / group / session: stamps every live
 * topic that hangs off any of the given parents (by `agent_id`, `session_id`
 * or `group_id`) in one statement.
 */
export const softDeleteByParents = async (
  ctx: TopicModelContext,
  parents: { agentIds?: string[]; groupIds?: string[]; sessionIds?: string[] },
  options: SoftDeleteOptions,
): Promise<TopicItem[]> => {
  const conditions: SQL[] = [];
  if (parents.agentIds?.length) conditions.push(inArray(topics.agentId, parents.agentIds));
  if (parents.sessionIds?.length) conditions.push(inArray(topics.sessionId, parents.sessionIds));
  if (parents.groupIds?.length) conditions.push(inArray(topics.groupId, parents.groupIds));
  if (conditions.length === 0) return [];

  return ctx.db
    .update(topics)
    .set(trashStamp(options.deletedAt))
    .where(
      and(
        or(...conditions),
        options.restrictToCreator ? ctx.mine() : ctx.ownership(),
        ctx.notShareVisitor(),
      ),
    )
    .returning();
};

export const softDeleteAll = async (
  ctx: TopicModelContext,
  options: SoftDeleteOptions,
): Promise<TopicItem[]> => {
  return ctx.db
    .update(topics)
    .set(trashStamp(options.deletedAt))
    .where(and(ctx.mine(), ctx.notShareVisitor()))
    .returning();
};

/** Bring trashed topics back. Only rows currently stamped are touched. */
export const restore = async (ctx: TopicModelContext, ids: string[]): Promise<TopicItem[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .update(topics)
    .set(restoreStamp())
    .where(and(inArray(topics.id, ids), ctx.trashScope(), isTrashed(topics.isDeleted)))
    .returning();
};

/** Trashed rows by id, bypassing the recycle-bin filter (restore / purge internals). */
export const findTrashedByIds = async (
  ctx: TopicModelContext,
  ids: string[],
): Promise<TopicItem[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .select()
    .from(topics)
    .where(and(inArray(topics.id, ids), ctx.trashScope(), isTrashed(topics.isDeleted)));
};

/**
 * Hard delete for the purge sweep: bypasses the recycle-bin filter so a
 * trashed row (invisible to `delete`) can actually be removed. FK cascades
 * take messages, threads and the rest with it.
 */
export const purge = async (ctx: TopicModelContext, ids: string[]): Promise<string[]> => {
  if (ids.length === 0) return [];
  // Only rows still stamped: a restore that commits between the registry
  // read and this delete must win, not be hard-deleted as a stale purge.
  const rows = await ctx.db
    .delete(topics)
    .where(and(inArray(topics.id, ids), ctx.trashScope(), isTrashed(topics.isDeleted)))
    .returning({ id: topics.id });
  return rows.map((row) => row.id);
};
