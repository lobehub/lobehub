import type { AgentOperationStatus, ChatTopicStatus, TopicOpenedBy } from '@lobechat/types';
import { and, desc, eq, inArray, isNull, not, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agentOperations, topics } from '../../schemas';
import { notTrashed } from '../../utils/softDelete';
import { topicRunStartedAtColumn } from '../../utils/topicRunStartedAt';
import type { TopicModelContext } from './context';

/**
 * The triggers a topic opened by another topic can carry: a sub-topic
 * (`lobe-topic.openTopic` / `lh topic send --new` from a conversation), a task run started from a
 * conversation, or a `lh topic send --new`. Sub-topic queries filter on these
 * first so `topics_trigger_idx` / the ownership index narrow the rows before
 * the unindexed jsonb comparison runs.
 */
export const OPENED_BY_TRIGGERS = ['sub_topic', 'task', 'cli'] as const;

/** How many generations below the openers are walked; deeper ones stay where they are. */
const MAX_OPENED_BY_DEPTH = 4;

/** Upper bound on rows one listing returns, so a runaway fan-out cannot flood a sidebar. */
const MAX_OPENED_BY_ROWS = 500;

export interface OpenedTopicItem {
  agentId: string | null;
  createdAt: Date;
  favorite: boolean | null;
  id: string;
  /** Status of the topic's latest top-level operation; null before its first run. */
  latestRunStatus: AgentOperationStatus | null;
  openedBy: TopicOpenedBy;
  runStartedAt: Date | null;
  status: ChatTopicStatus | null;
  /** The task a task-run sub-topic belongs to (`metadata.taskId`). */
  taskId: string | null;
  title: string | null;
  trigger: string | null;
  updatedAt: Date;
}

export interface ListOpenedTopicsParams {
  /** Statuses that hide a sub-topic (and stop the walk below it). */
  excludeStatuses?: ChatTopicStatus[];
  /** Also walk the sub-topics of the sub-topics found, so deeper ones can attach to a visible ancestor. */
  includeDescendants?: boolean;
  openerTopicIds: string[];
}

/**
 * The live (not detached, not trashed) topics opened by any of `openerTopicIds`,
 * newest activity first. With `includeDescendants`, their own sub-topics come
 * along too (bounded depth), so a list can attach a grandchild to the topmost
 * opener it shows.
 */
export const listOpenedTopics = async (
  ctx: TopicModelContext,
  { excludeStatuses, includeDescendants = false, openerTopicIds }: ListOpenedTopicsParams,
): Promise<OpenedTopicItem[]> => {
  const openers = [...new Set(openerTopicIds.filter(Boolean))];
  if (openers.length === 0) return [];

  const openedByTopicId = sql<string>`${topics.metadata} -> 'openedBy' ->> 'topicId'`;
  const statusCondition =
    excludeStatuses && excludeStatuses.length > 0
      ? or(isNull(topics.status), not(inArray(topics.status, excludeStatuses)))
      : undefined;
  const runStartedAt = topicRunStartedAtColumn(ctx.db);

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

  for (let depth = 0; depth < MAX_OPENED_BY_DEPTH && frontier.length > 0; depth += 1) {
    const rows = (await ctx.db
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
          inArray(topics.trigger, [...OPENED_BY_TRIGGERS]),
          inArray(openedByTopicId, frontier),
          // Never a jsonb null test in a qual — see the note on `TopicModel`.
          sql`COALESCE(${topics.metadata} -> 'openedBy' ->> 'detachedAt', '') = ''`,
          statusCondition,
        ),
      )
      .orderBy(desc(topics.updatedAt))
      .limit(MAX_OPENED_BY_ROWS)) as OpenedTopicItem[];

    const next: string[] = [];
    for (const row of rows) {
      if (included.has(row.id)) continue;
      included.add(row.id);
      result.push(row);
      if (walked.has(row.id)) continue;
      walked.add(row.id);
      next.push(row.id);
    }

    if (!includeDescendants || result.length >= MAX_OPENED_BY_ROWS) break;
    frontier = next;
  }

  return result.slice(0, MAX_OPENED_BY_ROWS);
};

/**
 * Every live descendant of `rootTopicId` (children, grandchildren, …), for
 * cascading archive / trash. Detached sub-topics are not descendants.
 */
export const listOpenedDescendants = async (
  ctx: TopicModelContext,
  rootTopicId: string,
  options: { excludeStatuses?: ChatTopicStatus[] } = {},
): Promise<OpenedTopicItem[]> =>
  listOpenedTopics(ctx, {
    excludeStatuses: options.excludeStatuses,
    includeDescendants: true,
    openerTopicIds: [rootTopicId],
  });

/**
 * Move sub-topics to the top level: stamp `openedBy.detachedAt`, and turn a
 * `sub_topic` trigger back into an ordinary conversation so the topic shows
 * up in its own agent's list. Task runs keep their trigger — they belong to
 * their task. Returns the rows that changed.
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
      trigger: sql`CASE WHEN ${topics.trigger} = 'sub_topic' THEN NULL ELSE ${topics.trigger} END`,
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
 * A `sub_topic` row whose opener is gone — deleted, in the recycle bin, or
 * archived (by a path that did not ask what to do with its sub-topics):
 * nothing lists it under that opener any more, so the target agent's own list
 * shows it at the top level instead of hiding it.
 *
 * The opener's columns go through `sql.identifier`: inside a correlated
 * subquery a bare `${topics.metadata}` renders unqualified and would resolve
 * against the inner alias.
 */
export const orphanSubTopicCondition = (ctx: TopicModelContext) => {
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

  return and(eq(topics.trigger, 'sub_topic'), notExists(liveOpener));
};
