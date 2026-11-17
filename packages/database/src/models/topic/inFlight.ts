import type { ChatTopicMetadata } from '@lobechat/types';
import { normalizeDirectoryPath } from '@lobechat/types';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { topics } from '../../schemas';
import type { TopicModelContext } from './context';
import { getTopicDeviceId } from './runningOperation';
import { hasLiveTaskCallbackReservation } from './taskCallback';

/**
 * Every checkout a topic may be running in. A worktree picked mid-conversation
 * is where a native agent works, but a local CLI agent's process still starts
 * in the source repository (`getWorkingDirSessionPath`), so both count. A
 * topic born in a worktree the app created runs its CLI there instead
 * (`sessionPath`), and nothing of it runs in the source. Over-counting only adds a confirmation; missing a
 * directory would let a branch switch run under a live agent.
 */
export const getTopicRunDirectories = (
  metadata: ChatTopicMetadata | null | undefined,
): string[] => {
  const config = metadata?.workingDirectoryConfig;
  const worktree = config?.git?.activeWorktree;
  // Born in the app's worktree: the CLI starts there (`sessionPath`), never in
  // the source, and the agent works wherever the topic's worktree is now.
  if (config?.sessionPath)
    return [worktree, config.sessionPath].filter((dir): dir is string => !!dir);
  return [worktree, config?.path, metadata?.workingDirectory].filter((dir): dir is string => !!dir);
};

/**
 * Same test as the project-directory guards (`isTopicInFlight`): a running
 * status, a live run marker, or a turn start that holds the short reservation.
 */
export const isInFlight = (topic: {
  metadata: ChatTopicMetadata | null | undefined;
  status: string | null;
}) =>
  topic.status === 'running' ||
  !!topic.metadata?.runningOperation ||
  hasLiveTaskCallbackReservation(topic.metadata);

/**
 * How many conversations are running in `path` on `deviceId` right now, so the
 * composer can warn before a send switches that directory's branch under them.
 *
 * Spans every member's conversations in a workspace (they share its devices)
 * and the caller's own in personal mode; private and trashed rows count too,
 * since they run on the same checkout. Only a number leaves this function.
 *
 * The SQL narrows to the device and to rows that may be in flight (`status`
 * uses `topics_status_idx`); the exact in-flight rule and the path comparison,
 * which must normalize both sides, run on the few rows that remain. A soft
 * signal: the caller confirms, never blocks, because a stale marker can
 * over-count.
 */
export const countInFlightInDirectory = async (
  ctx: TopicModelContext,
  { deviceId, path }: { deviceId: string; path: string },
): Promise<number> => {
  const target = normalizeDirectoryPath(path);
  if (!target) return 0;

  const scope = ctx.workspaceId
    ? eq(topics.workspaceId, ctx.workspaceId)
    : and(eq(topics.userId, ctx.userId), isNull(topics.workspaceId));

  const rows = await ctx.db
    .select({ metadata: topics.metadata, status: topics.status })
    .from(topics)
    .where(
      and(
        scope,
        sql`COALESCE(${topics.metadata} -> 'runningOperation' ->> 'deviceId', ${topics.metadata} ->> 'boundDeviceId') = ${deviceId}`,
        // Key existence, never `-> 'x' IS NOT NULL`: that shape crashes the
        // pg_search planner on bm25-indexed tables (see jsonbNullTest).
        or(
          eq(topics.status, 'running'),
          sql`COALESCE(jsonb_exists(${topics.metadata}, 'runningOperation'), false)`,
          sql`COALESCE(jsonb_exists(${topics.metadata}, 'taskCallbackReservation'), false)`,
        ),
      ),
    );

  return rows.filter((row) => {
    const metadata = row.metadata ?? null;
    if (!isInFlight({ metadata, status: row.status })) return false;
    if (getTopicDeviceId(metadata) !== deviceId) return false;
    return getTopicRunDirectories(metadata).some((dir) => normalizeDirectoryPath(dir) === target);
  }).length;
};
