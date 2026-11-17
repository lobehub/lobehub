import type { ChatTopicMetadata, OwnedWorktree } from '@lobechat/types';
import { claimAutoCreatedWorktree, resolveOwnedWorktrees } from '@lobechat/types';
import { and, eq, inArray, ne, notInArray, or, sql } from 'drizzle-orm';

import { topics } from '../../schemas';
import type { TopicModelContext } from './context';

/**
 * Persistence for `metadata.ownedWorktrees` — the worktrees the app created for
 * a topic and the state of their cleanup (see `@lobechat/types` ownedWorktree).
 *
 * Every read and write here spans the recycle bin (`trashScope`): a trashed
 * topic's worktree is exactly what gets cleaned up. Predicates over the jsonb
 * use containment (`@>`) and equality only — never a null test on an
 * extracted value, which crashes the pg_search planner (see `./index.ts`).
 */

/** A topic row as the cleanup reads it. */
export interface OwnedWorktreeTopicRow {
  id: string;
  isDeleted: boolean | null;
  metadata: ChatTopicMetadata | null | undefined;
  status: string | null;
  userId: string;
}

const rowColumns = {
  id: topics.id,
  isDeleted: topics.isDeleted,
  metadata: topics.metadata,
  status: topics.status,
  userId: topics.userId,
};

/**
 * Claim the worktree the app created for this topic into `ownedWorktrees`
 * whenever metadata carrying `workingDirectoryConfig.git.autoCreated` is
 * written. Applied on the create and merge paths of the model, so every writer
 * (server pipeline, desktop client) records it without knowing about it.
 */
export const withOwnedWorktreeClaim = <T extends ChatTopicMetadata | null | undefined>(
  metadata: T,
): T => (metadata ? (claimAutoCreatedWorktree(metadata) as T) : metadata);

/** Topics by id with their owned-worktree data, trashed ones included. */
export const findOwnedWorktreeTopics = async (
  ctx: TopicModelContext,
  ids: string[],
): Promise<OwnedWorktreeTopicRow[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .select(rowColumns)
    .from(topics)
    .where(and(inArray(topics.id, ids), ctx.trashScope()));
};

const containsEntry = (entry: Record<string, unknown>) =>
  sql`COALESCE(${topics.metadata} -> 'ownedWorktrees' @> ${JSON.stringify([entry])}::jsonb, false)`;

/**
 * Topics with a cleanup waiting on `deviceId` — or, with `deviceId` undefined,
 * on a desktop that never registered with the gateway (records without one).
 * Trashed topics included; the caller re-checks each before running it.
 */
export const findPendingOwnedWorktreeTopics = async (
  ctx: TopicModelContext,
  deviceId: string | undefined,
): Promise<OwnedWorktreeTopicRow[]> => {
  const rows = await ctx.db
    .select(rowColumns)
    .from(topics)
    .where(
      and(
        ctx.trashScope(),
        eq(topics.userId, ctx.userId),
        or(
          containsEntry({
            cleanup: { state: 'pending' },
            ...(deviceId && { deviceId }),
          }),
          // A claim whose executor died (closed app, crashed request): the
          // caller decides from `cleanup.at` whether it is stale.
          containsEntry({ cleanup: { state: 'running' }, ...(deviceId && { deviceId }) }),
        ),
      ),
    );
  if (deviceId) return rows;
  return rows.filter((row) =>
    row.metadata?.ownedWorktrees?.some(
      (entry) =>
        !entry.deviceId &&
        (entry.cleanup?.state === 'pending' || entry.cleanup?.state === 'running'),
    ),
  );
};

/**
 * Topics that own the worktree at `path` — by their record, or (for topics
 * that predate it) by the markers `resolveOwnedWorktrees` backfills from.
 * Trashed ones included; the caller filters for retired topics.
 */
export const findOwnersOfWorktree = async (
  ctx: TopicModelContext,
  path: string,
): Promise<OwnedWorktreeTopicRow[]> => {
  const rows = await ctx.db
    .select(rowColumns)
    .from(topics)
    .where(
      and(
        ctx.trashScope(),
        or(
          containsEntry({ path }),
          eq(sql<string>`${topics.metadata} -> 'workingDirectoryConfig' ->> 'sessionPath'`, path),
          sql`COALESCE(${topics.metadata} -> 'workingDirectoryConfig' -> 'git' @> ${JSON.stringify({ activeWorktree: path, autoCreated: true })}::jsonb, false)`,
        ),
      ),
    );
  return rows.filter((row) =>
    resolveOwnedWorktrees(row.metadata).some((entry) => entry.path === path),
  );
};

/**
 * How many other topics still use `path` as their working directory or CLI
 * start folder and are neither archived nor in the recycle bin. A worktree
 * shared like that (a handoff continuing in it) is not cleaned up yet.
 * Spans every member's topics in a workspace, which share its devices.
 */
export const countLiveTopicsUsingWorktree = async (
  ctx: TopicModelContext,
  { excludeIds, path }: { excludeIds: string[]; path: string },
): Promise<number> => {
  const variants = [...new Set([path, path.replace(/[/\\]+$/, '')])];
  const rows = await ctx.db
    .select({ id: topics.id })
    .from(topics)
    .where(
      and(
        // `workspaceScope` keeps trashed rows out.
        ctx.workspaceScope(),
        excludeIds.length > 0 ? notInArray(topics.id, excludeIds) : undefined,
        or(
          sql`${topics.status} IS NULL`,
          and(ne(topics.status, 'completed'), ne(topics.status, 'archived')),
        ),
        or(
          inArray(
            sql<string>`${topics.metadata} -> 'workingDirectoryConfig' -> 'git' ->> 'activeWorktree'`,
            variants,
          ),
          inArray(
            sql<string>`${topics.metadata} -> 'workingDirectoryConfig' ->> 'sessionPath'`,
            variants,
          ),
        ),
      ),
    );
  return rows.length;
};

/**
 * Rewrite one owned-worktree record under a row lock. `update` receives the
 * current record (backfilled from the legacy markers when the topic predates
 * `ownedWorktrees`) and returns the replacement, or `undefined` to leave the
 * row untouched — which is how a compare-and-set claim declines. Returns the
 * written record, or `undefined` when nothing was written.
 */
export const updateOwnedWorktree = async (
  ctx: TopicModelContext,
  topicId: string,
  path: string,
  update: (entry: OwnedWorktree, row: OwnedWorktreeTopicRow) => OwnedWorktree | undefined,
): Promise<OwnedWorktree | undefined> =>
  ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select(rowColumns)
      .from(topics)
      .where(and(eq(topics.id, topicId), ctx.trashScope()))
      .for('update');
    if (!row) return undefined;

    const owned = resolveOwnedWorktrees(row.metadata);
    const index = owned.findIndex((entry) => entry.path === path);
    if (index < 0) return undefined;
    const next = update(owned[index], row);
    if (!next) return undefined;

    const ownedWorktrees = owned.map((entry, i) => (i === index ? next : entry));
    await tx
      .update(topics)
      .set({ metadata: { ...row.metadata, ownedWorktrees } as ChatTopicMetadata })
      .where(and(eq(topics.id, topicId), ctx.trashScope()));
    return next;
  });
