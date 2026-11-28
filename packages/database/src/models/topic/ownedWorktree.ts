import type {
  ChatTopicMetadata,
  OwnedWorktree,
  OwnedWorktreeTopicRow,
  WorkingDirConfig,
} from '@lobechat/types';
import {
  claimAutoCreatedWorktree,
  getWorkingDirEffectivePath,
  isRetiredTopicStatus,
  resolveOwnedWorktrees,
} from '@lobechat/types';
import { and, eq, inArray, notInArray, or, type SQL, sql } from 'drizzle-orm';

import { topics } from '../../schemas';
import type { TopicModelContext } from './context';
import { isInFlight } from './inFlight';

/**
 * Persistence for `metadata.ownedWorktrees` — the worktrees the app created for
 * a topic and the state of their cleanup (see `@lobechat/types` ownedWorktree).
 *
 * Every read and write here spans the recycle bin (`trashScope`): a trashed
 * topic's worktree is exactly what gets cleaned up. Predicates over the jsonb
 * use containment (`@>`) and equality only — never a null test on an
 * extracted value, which crashes the pg_search planner (see `./index.ts`).
 */

export type { OwnedWorktreeTopicRow } from '@lobechat/types';

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

/**
 * The record a write must carry forward from the row it replaces: the
 * persisted `ownedWorktrees`, or — for a topic that predates it — the claim
 * backfilled from its old markers, resolved BEFORE a new working-directory
 * config replaces (and so erases) those markers.
 */
export const carriedOwnedWorktrees = (
  existing: ChatTopicMetadata | null | undefined,
): Pick<ChatTopicMetadata, 'ownedWorktrees'> => {
  const owned = resolveOwnedWorktrees(existing);
  return owned.length > 0 ? { ownedWorktrees: owned } : {};
};

/** Attach a checkout under the dispatch claim, or record it for cleanup if the topic retired meanwhile. */
export const recordFirstSendWorktreeCheckout = async (
  ctx: TopicModelContext,
  id: string,
  {
    claimId,
    deviceId,
    workingDirectoryConfig,
  }: { claimId?: string; deviceId: string; workingDirectoryConfig: WorkingDirConfig },
): Promise<{ canDispatch: boolean; cleanupTrigger?: 'archived' | 'trashed' }> =>
  ctx.db.transaction(async (tx) => {
    const ownedTopic = and(eq(topics.id, id), eq(topics.userId, ctx.userId), ctx.trashScope());
    const [row] = await tx.select(rowColumns).from(topics).where(ownedTopic).for('update');
    if (!row) return { canDispatch: false };

    const run = row.metadata?.scheduledRun;
    const ownsClaim = !!claimId && run?.kind === 'worktree_start' && run.claim?.id === claimId;
    const cleanupTrigger: 'archived' | 'trashed' | undefined = row.isDeleted
      ? 'trashed'
      : isRetiredTopicStatus(row.status)
        ? 'archived'
        : undefined;
    const canDispatch = !cleanupTrigger && ownsClaim && row.status === 'scheduled';
    const checkout = claimAutoCreatedWorktree({
      ...row.metadata,
      ...carriedOwnedWorktrees(row.metadata),
      boundDeviceId: deviceId,
      workingDirectory: getWorkingDirEffectivePath(workingDirectoryConfig),
      workingDirectoryConfig,
    });
    const ownedWorktrees = checkout.ownedWorktrees?.map((entry) =>
      cleanupTrigger && !entry.cleanup && entry.path === workingDirectoryConfig.git?.activeWorktree
        ? {
            ...entry,
            cleanup: {
              at: new Date().toISOString(),
              state: 'pending' as const,
              trigger: cleanupTrigger,
            },
          }
        : entry,
    );
    await tx
      .update(topics)
      .set({
        metadata: {
          ...(canDispatch ? checkout : row.metadata),
          ...(ownedWorktrees && { ownedWorktrees }),
          ...(cleanupTrigger && ownsClaim && { scheduledRun: null }),
        },
        ...(cleanupTrigger === 'trashed' &&
          ownsClaim &&
          row.status === 'scheduled' && { status: 'active' as const }),
      })
      .where(ownedTopic);
    return { canDispatch, cleanupTrigger };
  });

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
 * on a desktop that never registered with the gateway (records without one,
 * the caller's own only). Trashed topics included; the caller re-checks each before running it.
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
        // A device-bound cleanup belongs to whoever may operate that device —
        // every member of a workspace that shares it. One without a device
        // only ever ran on its creator's own desktop.
        deviceId ? undefined : eq(topics.userId, ctx.userId),
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
 * Topics under these agents, or listed by id, whose worktree cleanup is still
 * waiting (`pending` / `running`), trashed ones included: purging the parent
 * would take them with the only record of the folder to delete.
 */
export const findWaitingCleanupTopicsUnder = async (
  ctx: TopicModelContext,
  { agentIds, topicIds }: { agentIds: string[]; topicIds: string[] },
): Promise<OwnedWorktreeTopicRow[]> => {
  if (agentIds.length === 0 && topicIds.length === 0) return [];
  return ctx.db
    .select(rowColumns)
    .from(topics)
    .where(
      and(
        ctx.trashScope(),
        or(
          agentIds.length > 0 ? inArray(topics.agentId, agentIds) : undefined,
          topicIds.length > 0 ? inArray(topics.id, topicIds) : undefined,
        ),
        or(
          containsEntry({ cleanup: { state: 'pending' } }),
          containsEntry({ cleanup: { state: 'running' } }),
        ),
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
 * start folder. A worktree shared like that (a handoff continuing in it) is
 * not cleaned up yet. "Still" means not archived and not in the recycle bin —
 * or archived or trashed with a run still going there, since retiring a topic
 * does not stop its run. Spans every member's topics in a workspace, which
 * share its devices.
 */
export const countLiveTopicsUsingWorktree = async (
  ctx: TopicModelContext,
  { excludeIds, path }: { excludeIds: string[]; path: string },
): Promise<number> => {
  const base = path.replace(/[/\\]+$/, '');
  const variants = [...new Set([path, base])];
  // Below the folder too (a topic working in `<worktree>/packages/foo`), cut at
  // a separator so `<worktree>-other` never matches. LIKE wildcards escaped.
  const escaped = base.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  const descendants = [`${escaped}/%`, `${escaped}\\\\%`];
  const pointsInto = (expr: SQL<string>) =>
    or(
      inArray(expr, variants),
      ...descendants.map((pattern) => sql`${expr} LIKE ${pattern} ESCAPE '\\'`),
    );
  const rows = await ctx.db
    .select({ isDeleted: topics.isDeleted, metadata: topics.metadata, status: topics.status })
    .from(topics)
    .where(
      and(
        // Recycle bin included: a trashed topic may still be running there.
        ctx.trashScope(),
        excludeIds.length > 0 ? notInArray(topics.id, excludeIds) : undefined,
        // Every way a topic can point at the folder: its current worktree, its
        // CLI start folder, or the folder itself picked as its directory.
        or(
          pointsInto(
            sql<string>`${topics.metadata} -> 'workingDirectoryConfig' -> 'git' ->> 'activeWorktree'`,
          ),
          pointsInto(sql<string>`${topics.metadata} -> 'workingDirectoryConfig' ->> 'sessionPath'`),
          pointsInto(sql<string>`${topics.metadata} -> 'workingDirectoryConfig' ->> 'path'`),
          pointsInto(sql<string>`${topics.metadata} ->> 'workingDirectory'`),
        ),
      ),
    );
  return rows.filter((row) => {
    const retired = !!row.isDeleted || row.status === 'completed' || row.status === 'archived';
    return !retired || isInFlight(row);
  }).length;
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
