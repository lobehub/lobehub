import type { ChatTopicStatus, TopicQuerySortBy } from '@lobechat/types';
import {
  getDurationMs,
  logTimingSink as logTiming,
  runTimedSinkStage as runTimedStage,
} from '@lobechat/utils';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { agents, chatGroups, messages, topics } from '../../schemas';
import { topicRunStartedAtColumn } from '../../utils/topicRunStartedAt';
import { notChannelTopic } from '../../utils/topicVisibility';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { topicMetadataWithCreator } from '../topicCreator';
import { topicHasGoal } from '../topicGoal';
import type { TopicModelContext } from './context';
import type { QueryTopicParams, TopicListItem } from './types';

/**
 * How much of the last assistant reply `queryTopics` ships to a list view. Long
 * enough that a run summary arrives whole, short enough that 200 rows of raw
 * markdown never do — anything past it is marked with an ellipsis, and the full
 * text is one click away in the topic itself.
 */
export const LAST_MESSAGE_PREVIEW_LENGTH = 2000;

// Status priority for the sidebar "group by status" ordering. Lower rank =
// higher in the list. A NULL / unknown status falls through to `active` (3),
// matching the client which treats a missing status as active. Keep this in
// sync with `STATUS_GROUP_ORDER` / `resolveStatusBucket` in `@lobechat/utils`
// (client-side bucketing): `waitingForHuman`, `failed` and `unread` all collapse
// into the top `pending` bucket, so they must float to the top here too —
// otherwise such a topic could fall off the first page and vanish from the
// pending group.
export const STATUS_SORT_RANK = sql`CASE ${topics.status}
  WHEN 'waitingForHuman' THEN 0
  WHEN 'failed' THEN 1
  WHEN 'unread' THEN 2
  WHEN 'running' THEN 3
  WHEN 'scheduled' THEN 4
  WHEN 'active' THEN 5
  WHEN 'completed' THEN 6
  WHEN 'archived' THEN 7
  ELSE 5 END`;

// Favorites always float to the top; the rest are ordered by the requested
// strategy. `status` adds the priority bucket before the recency tiebreaker.
export const buildTopicOrderBy = (topicActivityAt: SQL, sortBy?: TopicQuerySortBy): SQL[] =>
  sortBy === 'status'
    ? [desc(topics.favorite), asc(STATUS_SORT_RANK), desc(topicActivityAt)]
    : [desc(topics.favorite), desc(topicActivityAt)];

export const query = async (
  ctx: TopicModelContext,
  {
    agentId,
    containerId,
    current = 0,
    editingAgentId,
    editingGroupId,
    excludeStatuses,
    excludeTriggers,
    includeTriggers,
    pageSize = 9999,
    groupId,
    isInbox,
    legacySessionId,
    onlyMine,
    sortBy,
    timing,
    triggers,
    withDetails = false,
  }: QueryTopicParams = {},
) => {
  const queryStartedAt = Date.now();
  logTiming(timing, 'db.topic.query:start', {
    current,
    hasAgentId: !!agentId,
    hasContainerId: !!containerId,
    hasGroupId: !!groupId,
    isInbox: !!isInbox,
    pageSize,
    withDetails,
  });
  const offset = current * pageSize;

  // Heavier columns gated behind `withDetails` and used by the per-agent
  // Topics management page: real aggregates from the `messages` table
  // (firstUserMessage + messageCount), plus the `description` / `trigger`
  // columns that sidebar paths don't consume. `cost` and `tokenUsage`
  // intentionally stay undefined here — they need their own schema
  // migration before they can be backed by real numbers.
  //
  // The two correlated subqueries are built with Drizzle's query builder
  // (not a raw `sql` template) so the inner `eq(messages.topicId,
  // topics.id)` renders as `"messages"."topic_id" = "topics"."id"` — both
  // sides fully qualified. A bare `sql\`... ${topics.id} ...\`` template
  // renders `topics.id` as an unqualified `"id"`, which PostgreSQL then
  // resolves against the inner FROM (messages.id) and the WHERE silently
  // matches nothing.
  const firstUserMessageSubquery = ctx.db
    .select({ value: messages.content })
    .from(messages)
    .where(and(eq(messages.topicId, topics.id), eq(messages.role, 'user'), ctx.messageOwnership()))
    .orderBy(asc(messages.createdAt))
    .limit(1);
  const messageCountSubquery = ctx.db
    .select({ value: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.topicId, topics.id), ctx.messageOwnership()));
  const latestMessageAtSubquery = ctx.db
    .select({ value: messages.updatedAt })
    .from(messages)
    .where(and(eq(messages.topicId, topics.id), ctx.messageOwnership()))
    .orderBy(desc(messages.updatedAt))
    .limit(1);
  const topicActivityAt =
    sql<Date>`COALESCE((${latestMessageAtSubquery}), ${topics.updatedAt})`.mapWith(
      topics.updatedAt,
    );

  const runStartedAtColumn = topicRunStartedAtColumn(ctx.db);

  const orderBy = buildTopicOrderBy(topicActivityAt, sortBy);

  const detailColumns = withDetails
    ? {
        description: topics.description,
        firstUserMessage: sql<string | null>`(${firstUserMessageSubquery})`.as(
          'first_user_message',
        ),
        messageCount: sql<number>`(${messageCountSubquery})`.as('message_count'),
        trigger: topics.trigger,
      }
    : {};

  const includeTriggerCondition =
    includeTriggers && includeTriggers.length > 0
      ? inArray(topics.trigger, includeTriggers)
      : undefined;
  const excludeTriggerCondition = includeTriggerCondition
    ? undefined
    : excludeTriggers && excludeTriggers.length > 0
      ? or(isNull(topics.trigger), not(inArray(topics.trigger, excludeTriggers)))
      : undefined;
  const triggerCondition =
    triggers && triggers.length > 0 ? inArray(topics.trigger, triggers) : undefined;
  const excludeStatusCondition =
    excludeStatuses && excludeStatuses.length > 0
      ? or(isNull(topics.status), not(inArray(topics.status, excludeStatuses as ChatTopicStatus[])))
      : undefined;
  // In a workspace `ownership()` matches every member's rows; this narrows the
  // list to the caller's own topics.
  const onlyMineCondition = onlyMine ? eq(topics.userId, ctx.userId) : undefined;
  // Topics created before the marker existed carry neither key and therefore
  // match no target — they cannot: what they configured was never recorded
  // anywhere in the row. `topics_agent_id_idx` still drives the scan, so the
  // unindexed JSONB comparison only runs over one agent's rows.
  const editingTargetCondition = and(
    editingAgentId ? sql`${topics.metadata}->>'editingAgentId' = ${editingAgentId}` : undefined,
    editingGroupId ? sql`${topics.metadata}->>'editingGroupId' = ${editingGroupId}` : undefined,
  );

  if (groupId) {
    const whereCondition = and(
      ctx.ownership(),
      ctx.notShareVisitor(),
      notChannelTopic(),
      eq(topics.groupId, groupId),
      includeTriggerCondition,
      excludeTriggerCondition,
      triggerCondition,
      excludeStatusCondition,
      onlyMineCondition,
    );

    const [items, totalResult] = await Promise.all([
      runTimedStage(
        timing,
        'db.topic.query.group.items.select',
        () =>
          ctx.db
            // Cast to `any` because Drizzle's `.select` infers a strict
            // SelectedFields shape and the conditional `detailColumns` widens
            // to a union; the runtime shape is correct and the client casts
            // back to `ChatTopic[]` after TRPC serialization.
            .select({
              completedAt: topics.completedAt,
              createdAt: topics.createdAt,
              favorite: topics.favorite,
              historySummary: topics.historySummary,
              id: topics.id,
              metadata: topicMetadataWithCreator(ctx.db, ctx.messageOwnership()),
              projectId: topics.projectId,
              projectWorkingDirectoryId: topics.projectWorkingDirectoryId,
              model: topics.model,
              provider: topics.provider,
              runStartedAt: runStartedAtColumn,
              status: topics.status,
              title: topics.title,
              updatedAt: topics.updatedAt,
              // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
              // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
              // fallback to the row's own updatedAt). Keeping it separate from the
              // display `updatedAt` above matches the client-side sort key to the server
              // order (otherwise the two disagree and the list visibly jumps) while a
              // rename/favorite edit still shows its real edit time. See rankTopics for
              // the same activity-time pattern.
              sortUpdatedAt: topicActivityAt,
              // Workspace sidebars filter maintenance actions client-side by
              // ownership (own vs workspace scope) — the filter needs the row
              // owner even in the slim projection.
              userId: topics.userId,
              ...detailColumns,
            } as any)
            .from(topics)
            .where(whereCondition)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset),
        { current, pageSize },
      ),
      runTimedStage(timing, 'db.topic.query.group.count.select', () =>
        ctx.db
          .select({ count: count(topics.id) })
          .from(topics)
          .where(whereCondition),
      ),
    ]);

    logTiming(timing, 'db.topic.query:done', {
      itemCount: items.length,
      stageMs: getDurationMs(queryStartedAt),
      total: totalResult[0].count,
    });
    return { items, total: totalResult[0].count };
  }

  // If agentId is provided, match topics by `topics.agentId` directly. The
  // inbox agent additionally adopts very old orphan rows where every owner
  // column (session / group / agent) is null.
  if (agentId) {
    const agentCondition = or(
      eq(topics.agentId, agentId),
      legacySessionId
        ? and(isNull(topics.agentId), eq(topics.sessionId, legacySessionId))
        : undefined,
      isInbox
        ? and(isNull(topics.sessionId), isNull(topics.groupId), isNull(topics.agentId))
        : undefined,
    );

    const agentWhere = and(
      ctx.ownership(),
      ctx.notShareVisitor(),
      notChannelTopic(),
      agentCondition,
      editingTargetCondition,
      includeTriggerCondition,
      excludeTriggerCondition,
      triggerCondition,
      excludeStatusCondition,
      onlyMineCondition,
    );

    const [items, totalResult] = await Promise.all([
      runTimedStage(
        timing,
        'db.topic.query.agent.items.select',
        () =>
          ctx.db
            // See note on the group-branch select above re: `as any` cast.
            .select({
              completedAt: topics.completedAt,
              createdAt: topics.createdAt,
              favorite: topics.favorite,
              // Marks the goal's planning conversation in the agent sidebar.
              hasGoal: topicHasGoal(ctx.db, ctx),
              historySummary: topics.historySummary,
              id: topics.id,
              metadata: topicMetadataWithCreator(ctx.db, ctx.messageOwnership()),
              projectId: topics.projectId,
              projectWorkingDirectoryId: topics.projectWorkingDirectoryId,
              model: topics.model,
              provider: topics.provider,
              runStartedAt: runStartedAtColumn,
              status: topics.status,
              title: topics.title,
              updatedAt: topics.updatedAt,
              // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
              // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
              // fallback to the row's own updatedAt). Keeping it separate from the
              // display `updatedAt` above matches the client-side sort key to the server
              // order (otherwise the two disagree and the list visibly jumps) while a
              // rename/favorite edit still shows its real edit time. See rankTopics for
              // the same activity-time pattern.
              sortUpdatedAt: topicActivityAt,
              // Workspace sidebars filter maintenance actions client-side by
              // ownership (own vs workspace scope) — the filter needs the row
              // owner even in the slim projection.
              userId: topics.userId,
              ...detailColumns,
            } as any)
            .from(topics)
            .where(agentWhere)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset),
        { current, isInbox: !!isInbox, pageSize },
      ),
      runTimedStage(
        timing,
        'db.topic.query.agent.count.select',
        () =>
          ctx.db
            .select({ count: count(topics.id) })
            .from(topics)
            .where(agentWhere),
        { isInbox: !!isInbox },
      ),
    ]);

    logTiming(timing, 'db.topic.query:done', {
      itemCount: items.length,
      stageMs: getDurationMs(queryStartedAt),
      total: totalResult[0].count,
    });
    return { items, total: totalResult[0].count };
  }

  // Fallback to containerId-based query (backward compatibility)
  const whereCondition = and(
    ctx.ownership(),
    ctx.notShareVisitor(),
    notChannelTopic(),
    ctx.matchContainer(containerId),
    includeTriggerCondition,
    excludeTriggerCondition,
    triggerCondition,
    excludeStatusCondition,
    onlyMineCondition,
  );

  const [items, totalResult] = await Promise.all([
    runTimedStage(
      timing,
      'db.topic.query.container.items.select',
      () =>
        ctx.db
          // See note on the group-branch select above re: `as any` cast.
          .select({
            agentId: topics.agentId,
            completedAt: topics.completedAt,
            createdAt: topics.createdAt,
            favorite: topics.favorite,
            historySummary: topics.historySummary,
            id: topics.id,
            metadata: topicMetadataWithCreator(ctx.db, ctx.messageOwnership()),
            projectId: topics.projectId,
            projectWorkingDirectoryId: topics.projectWorkingDirectoryId,
            model: topics.model,
            provider: topics.provider,
            runStartedAt: runStartedAtColumn,
            sessionId: topics.sessionId,
            status: topics.status,
            title: topics.title,
            updatedAt: topics.updatedAt,
            // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
            // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
            // fallback to the row's own updatedAt). Keeping it separate from the
            // display `updatedAt` above matches the client-side sort key to the server
            // order (otherwise the two disagree and the list visibly jumps) while a
            // rename/favorite edit still shows its real edit time. See rankTopics for
            // the same activity-time pattern.
            sortUpdatedAt: topicActivityAt,
            // Workspace sidebars filter maintenance actions client-side by
            // ownership (own vs workspace scope) — the filter needs the row
            // owner even in the slim projection.
            userId: topics.userId,
            ...detailColumns,
          } as any)
          .from(topics)
          .where(whereCondition)
          .orderBy(...orderBy)
          .limit(pageSize)
          .offset(offset),
      { current, pageSize },
    ),
    runTimedStage(timing, 'db.topic.query.container.count.select', () =>
      ctx.db
        .select({ count: count(topics.id) })
        .from(topics)
        .where(whereCondition),
    ),
  ]);

  // Remove internal fields before returning

  const cleanItems = items.map(({ agentId: _agentId, sessionId: _sessionId, ...rest }) => rest);

  logTiming(timing, 'db.topic.query:done', {
    itemCount: cleanItems.length,
    stageMs: getDurationMs(queryStartedAt),
    total: totalResult[0].count,
  });

  return { items: cleanItems, total: totalResult[0].count };
};

/**
 * Query the current user's topics, optionally filtered by status — e.g. to
 * list actively-running topics across all agents without pulling the full
 * topic set to the client.
 *
 * `withLastMessage` additionally pulls each topic's last assistant reply, so a
 * list can show what the agent actually said instead of just a title. The
 * preview is truncated server-side — raw assistant output is unbounded
 * markdown, and a list only ever renders the head of it.
 */
export const queryTopics = async (
  ctx: TopicModelContext,
  {
    deviceId,
    statuses,
    pageSize = 200,
    withLastMessage,
  }: {
    /**
     * Only topics on this device — the one its in-flight run was dispatched to
     * (`metadata.runningOperation.deviceId`), else the one its turns are
     * pinned to (`metadata.boundDeviceId`). See {@link getTopicDeviceId},
     * which applies the same precedence in memory.
     */
    deviceId?: string;
    pageSize?: number;
    statuses?: string[];
    withLastMessage?: boolean;
  } = {},
): Promise<TopicListItem[]> => {
  const scope = { userId: ctx.userId, workspaceId: ctx.workspaceId };

  // Unlike the per-agent topic list, this feed is not scoped by agent at all:
  // in a workspace `ownership()` matches every member's rows, so a topic
  // whose owning agent/group is someone else's PRIVATE conversation would
  // surface here — title and last assistant reply included. Gate on the
  // parent the same way the Recent feed does. Rows with no resolvable parent
  // (legacy session-only topics) have nothing to check and keep the previous
  // behaviour.
  const visibleParentWhere = or(
    and(isNull(topics.agentId), isNull(topics.groupId)),
    and(isNotNull(topics.groupId), buildWorkspaceWhere(scope, chatGroups)),
    and(isNull(topics.groupId), isNotNull(topics.agentId), buildWorkspaceWhere(scope, agents)),
  );

  const where = and(
    ctx.ownership(),
    ctx.notShareVisitor(),
    notChannelTopic(),
    visibleParentWhere,
    statuses && statuses.length > 0
      ? inArray(topics.status, statuses as ChatTopicStatus[])
      : undefined,
    deviceId
      ? sql`COALESCE(${topics.metadata} -> 'runningOperation' ->> 'deviceId', ${topics.metadata} ->> 'boundDeviceId') = ${deviceId}`
      : undefined,
  );

  // `buildWorkspaceWhere` keeps a member's OWN private rows visible, which is
  // right for a "mine" list and wrong for a shared one. Ship the parent's
  // visibility so the caller's team view can drop private conversations
  // without a second round trip.
  const parentVisibilityColumn = sql<
    'private' | 'public' | null
  >`COALESCE(${chatGroups.visibility}, ${agents.visibility})`.as('parent_visibility');

  const runStartedAtColumn = topicRunStartedAtColumn(ctx.db);

  if (!withLastMessage) {
    return ctx.db
      .select({
        ...getTableColumns(topics),
        metadata: topicMetadataWithCreator(ctx.db, ctx.messageOwnership()),
        parentVisibility: parentVisibilityColumn,
        runStartedAt: runStartedAtColumn,
      })
      .from(topics)
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .leftJoin(chatGroups, eq(topics.groupId, chatGroups.id))
      .where(where)
      .orderBy(desc(topics.updatedAt))
      .limit(pageSize);
  }

  // Built with the query builder rather than a raw `sql` template so the inner
  // `eq(messages.topicId, topics.id)` renders both sides fully qualified —
  // see the note on `firstUserMessageSubquery` in `query()`.
  //
  // Assistant turns that only carried tool calls persist an empty `content`;
  // skipping them lands on the last thing the agent actually *said*.
  // One char past the limit, so the caller can tell "exactly this long" from
  // "cut short" and mark the cut instead of ending mid-sentence.
  const lastAssistantMessageSubquery = ctx.db
    .select({
      value: sql<string>`left(${messages.content}, ${LAST_MESSAGE_PREVIEW_LENGTH + 1})`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.topicId, topics.id),
        eq(messages.role, 'assistant'),
        ctx.messageOwnership(),
        ne(messages.content, ''),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const rows = await ctx.db
    .select({
      ...getTableColumns(topics),
      metadata: topicMetadataWithCreator(ctx.db, ctx.messageOwnership()),
      lastAssistantMessage: sql<string | null>`(${lastAssistantMessageSubquery})`.as(
        'last_assistant_message',
      ),
      parentVisibility: parentVisibilityColumn,
      runStartedAt: runStartedAtColumn,
    })
    .from(topics)
    .leftJoin(agents, eq(topics.agentId, agents.id))
    .leftJoin(chatGroups, eq(topics.groupId, chatGroups.id))
    .where(where)
    .orderBy(desc(topics.updatedAt))
    .limit(pageSize);

  return rows.map((row) => ({
    ...row,
    lastAssistantMessage:
      row.lastAssistantMessage && row.lastAssistantMessage.length > LAST_MESSAGE_PREVIEW_LENGTH
        ? `${row.lastAssistantMessage.slice(0, LAST_MESSAGE_PREVIEW_LENGTH)}…`
        : row.lastAssistantMessage,
  }));
};
