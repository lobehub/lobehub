import type {
  AgentOperationStatus,
  ChatTopicStatus,
  OpenedTopicItem,
  TopicOpenedBy,
} from '@lobechat/types';
import { and, desc, eq, exists, inArray, isNull, not, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agentOperations, taskTopics, topics } from '../../schemas';
import { notTrashed } from '../../utils/softDelete';
import { topicRunStartedAtColumn } from '../../utils/topicRunStartedAt';
import { topicsOwnership } from '../task/context';
import type { TopicModelContext } from './context';

/** How many generations below the openers a listing walks; deeper ones stay where they are. */
const MAX_OPENED_BY_DEPTH = 4;

/** Upper bound on rows one listing returns, so a runaway fan-out cannot flood a sidebar. */
const MAX_OPENED_BY_ROWS = 500;

export type { OpenedTopicItem } from '@lobechat/types';

export interface ListOpenedTopicsParams {
  /** Statuses that hide a sub-topic (and stop the walk below it). */
  excludeStatuses?: ChatTopicStatus[];
  /** Also walk the sub-topics of the sub-topics found, so deeper ones can attach to a visible ancestor. */
  includeDescendants?: boolean;
  openerTopicIds: string[];
}

interface WalkLimits {
  maxDepth: number;
  /** Rows per generation query and in all; `undefined` = no cap. */
  maxRows?: number;
}

/**
 * The live (not detached, not trashed) topics opened by any of `openerTopicIds`,
 * newest activity first. With `includeDescendants`, their own sub-topics come
 * along too (bounded depth), so a list can attach a grandchild to the topmost
 * opener it shows.
 */
export const listOpenedTopics = (
  ctx: TopicModelContext,
  params: ListOpenedTopicsParams,
): Promise<OpenedTopicItem[]> =>
  walkOpenedTopics(ctx, params, { maxDepth: MAX_OPENED_BY_DEPTH, maxRows: MAX_OPENED_BY_ROWS });

const walkOpenedTopics = async (
  ctx: TopicModelContext,
  { excludeStatuses, includeDescendants = false, openerTopicIds }: ListOpenedTopicsParams,
  { maxDepth, maxRows }: WalkLimits,
): Promise<OpenedTopicItem[]> => {
  const openers = [...new Set(openerTopicIds.filter(Boolean))];
  if (openers.length === 0) return [];

  const openedByTopicId = sql<string>`${topics.metadata} -> 'openedBy' ->> 'topicId'`;
  const statusCondition =
    excludeStatuses && excludeStatuses.length > 0
      ? or(isNull(topics.status), not(inArray(topics.status, excludeStatuses)))
      : undefined;
  const runStartedAt = topicRunStartedAtColumn(ctx.db);
  // A task run is listed only when the caller may see that run of its task:
  // a private task's runs stay with their runner and the task's creator.
  const visibleTaskRun = ctx.db
    .select({ one: sql`1` })
    .from(taskTopics)
    .where(
      and(
        // The outer row's id: qualified, or it would resolve against task_topics.
        sql`${taskTopics.topicId} = ${sql.identifier('topics')}.${sql.identifier('id')}`,
        topicsOwnership({ db: ctx.db, userId: ctx.userId, workspaceId: ctx.workspaceId }),
      ),
    );
  // `trigger` is null for most topics, and `NOT (null = 'task')` is null: say so explicitly.
  const taskVisibilityCondition = or(
    isNull(topics.trigger),
    not(eq(topics.trigger, 'task')),
    sql`exists (${visibleTaskRun})`,
  );

  // The latest top-level run decides what a sub-topic is doing: server runs
  // keep `topics.status` as it was and only write the operation row.
  const latestRunStatus = ctx.db
    .select({ value: agentOperations.status })
    .from(agentOperations)
    .where(and(eq(agentOperations.topicId, topics.id), isNull(agentOperations.parentOperationId)))
    .orderBy(desc(agentOperations.createdAt))
    .limit(1);

  const result: OpenedTopicItem[] = [];
  // A row that is an opener itself (a list row) can still be another opener's
  // sub-topic: it is reported, it just is not walked twice.
  const included = new Set<string>();
  const walked = new Set<string>(openers);
  let frontier = openers;

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const query = ctx.db
      .select({
        agentId: topics.agentId,
        createdAt: topics.createdAt,
        favorite: topics.favorite,
        id: topics.id,
        latestRunStatus: sql<AgentOperationStatus | null>`(${latestRunStatus})`,
        openedBy: sql<TopicOpenedBy>`${topics.metadata} -> 'openedBy'`,
        runStartedAt,
        status: topics.status,
        taskId: sql<string | null>`${topics.metadata} ->> 'taskId'`,
        title: topics.title,
        trigger: topics.trigger,
        updatedAt: topics.updatedAt,
      })
      .from(topics)
      .where(
        and(
          ctx.ownership(),
          inArray(openedByTopicId, frontier),
          taskVisibilityCondition,
          // Never a jsonb null test in a qual — see the note on `TopicModel`.
          sql`COALESCE(${topics.metadata} -> 'openedBy' ->> 'detachedAt', '') = ''`,
          statusCondition,
        ),
      )
      .orderBy(desc(topics.updatedAt));
    const rows = (await (maxRows === undefined
      ? query
      : query.limit(maxRows))) as unknown as OpenedTopicItem[];

    const next: string[] = [];
    for (const row of rows) {
      if (included.has(row.id)) continue;
      included.add(row.id);
      result.push(row);
      if (walked.has(row.id)) continue;
      walked.add(row.id);
      next.push(row.id);
    }

    if (!includeDescendants || (maxRows !== undefined && result.length >= maxRows)) break;
    frontier = next;
  }

  return maxRows === undefined ? result : result.slice(0, maxRows);
};

/**
 * Every live descendant of `rootTopicId` (children, grandchildren, …), for
 * cascading archive / trash. Detached sub-topics are not descendants.
 *
 * Unlike a sidebar listing this walk is exhaustive — no depth or row cap — so
 * "archive / delete all" never leaves a deep or wide branch running under a
 * retired parent. Each topic is walked once (the `walked` set), so a cycle in
 * `openedBy` cannot loop.
 */
export const listOpenedDescendants = async (
  ctx: TopicModelContext,
  rootTopicId: string,
  options: { excludeStatuses?: ChatTopicStatus[] } = {},
): Promise<OpenedTopicItem[]> => {
  const rows = await walkOpenedTopics(
    ctx,
    {
      excludeStatuses: options.excludeStatuses,
      includeDescendants: true,
      openerTopicIds: [rootTopicId],
    },
    { maxDepth: Number.POSITIVE_INFINITY },
  );
  // The root is never its own descendant, even if a hand-edited link loops back to it.
  return rows.filter((row) => row.id !== rootTopicId);
};

/**
 * Status of `topicId`'s latest top-level operation (null before its first
 * run) — what the listings report as `latestRunStatus`, for one topic.
 */
export const getLatestRunStatus = async (
  ctx: TopicModelContext,
  topicId: string,
): Promise<AgentOperationStatus | null> => {
  const [row] = await ctx.db
    .select({ status: agentOperations.status })
    .from(agentOperations)
    .innerJoin(topics, eq(topics.id, agentOperations.topicId))
    .where(
      and(
        eq(agentOperations.topicId, topicId),
        isNull(agentOperations.parentOperationId),
        ctx.ownership(),
      ),
    )
    .orderBy(desc(agentOperations.createdAt))
    .limit(1);
  return (row?.status as AgentOperationStatus | undefined) ?? null;
};

/**
 * Move sub-topics to the top level: stamp `openedBy.detachedAt`, so the topic
 * no longer lists under its parent and shows in its own agent's list. Returns
 * the rows that changed.
 */
export const detachOpenedTopics = async (
  ctx: TopicModelContext,
  topicIds: string[],
  detachedAt: string = new Date().toISOString(),
): Promise<{ agentId: string | null; id: string; trigger: string | null }[]> => {
  if (topicIds.length === 0) return [];

  return ctx.db
    .update(topics)
    .set({
      metadata: sql`jsonb_set(${topics.metadata}, '{openedBy,detachedAt}', to_jsonb(${detachedAt}::text), true)`,
    })
    .where(
      and(
        inArray(topics.id, topicIds),
        // Only the caller's own topics: in a workspace `ownership()` also
        // matches teammates' rows, and moving those is not this caller's call.
        ctx.mine(),
        ctx.notShareVisitor(),
        sql`COALESCE(${topics.metadata} -> 'openedBy' ->> 'topicId', '') <> ''`,
      ),
    )
    .returning({ agentId: topics.agentId, id: topics.id, trigger: topics.trigger });
};

/**
 * A topic opened from a parent that is still there — linked (not detached),
 * the parent neither deleted, in the recycle bin nor archived. Such a topic
 * lists under its parent, so an agent's own list can leave it out
 * (`QueryTopicParams.excludeOpenedTopics`); once its parent is gone it shows
 * at the top level again.
 *
 * The outer columns go through `sql.identifier`: inside a correlated subquery
 * a bare `${topics.metadata}` renders unqualified and would resolve against
 * the inner alias.
 */
export const openedFromLiveParentCondition = (ctx: TopicModelContext) => {
  const opener = alias(topics, 'opened_by_opener');
  const outerOpenedBy = sql`${sql.identifier('topics')}.${sql.identifier('metadata')} -> 'openedBy' ->> 'topicId'`;
  const liveOpener = ctx.db
    .select({ one: sql`1` })
    .from(opener)
    .where(
      and(
        eq(opener.id, outerOpenedBy),
        notTrashed(opener.isDeleted),
        or(isNull(opener.status), not(inArray(opener.status, ['completed', 'archived']))),
      ),
    );

  return and(
    sql`COALESCE(${topics.metadata} -> 'openedBy' ->> 'detachedAt', '') = ''`,
    exists(liveOpener),
  );
};

/**
 * Whether `topicId` is a linked sub-topic, at any depth, of `ancestorTopicId`:
 * walks `openedBy` up through the caller's topics until it reaches the
 * ancestor, an unlinked topic, or a topic it has already seen.
 */
export const isOpenedBy = async (
  ctx: TopicModelContext,
  topicId: string,
  ancestorTopicId: string,
): Promise<boolean> => {
  const seen = new Set<string>();
  let cursor: string | undefined = topicId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const rows: { openedBy: TopicOpenedBy | null }[] = await ctx.db
      .select({ openedBy: sql<TopicOpenedBy | null>`${topics.metadata} -> 'openedBy'` })
      .from(topics)
      .where(and(eq(topics.id, cursor), ctx.ownership()))
      .limit(1);
    const openedBy: TopicOpenedBy | null | undefined = rows[0]?.openedBy;
    if (!openedBy?.topicId || openedBy.detachedAt) return false;
    if (openedBy.topicId === ancestorTopicId) return true;
    cursor = openedBy.topicId;
  }
  return false;
};
