import { runTimedSinkStage as runTimedStage } from '@lobechat/utils';

import { emitDatabaseEvent } from '../../events';
import { type TopicItem, topics } from '../../schemas';
import { joinTopicAgentsToProjects } from '../../utils/projectTopicAgents';
import { buildWorkspacePayload } from '../../utils/workspace';
import type { TopicModelContext } from './context';
import { withOwnedWorktreeClaim } from './ownedWorktree';
import type { CreateTopicParams, ModelTimingContext } from './types';

/**
 * Inserts one topic row. Re-parenting existing messages onto the new topic is
 * a cross-aggregate write owned by `TopicRepository.create`, which composes
 * this insert inside its transaction.
 */
export const create = async (
  ctx: TopicModelContext,
  topicParams: Omit<CreateTopicParams, 'messages'>,
  id: string = ctx.genId(),
  timing?: ModelTimingContext,
): Promise<TopicItem> => {
  // The type rejects a literal `messages` key; this also catches a widened
  // `CreateTopicParams` value so a missed caller fails instead of silently
  // dropping the re-parenting.
  const { messages: messageIds, ...params } = topicParams as CreateTopicParams;
  if (messageIds && messageIds.length > 0) {
    throw new Error(
      'TopicModel.create does not re-parent messages; use TopicRepository.create instead',
    );
  }

  const insertData = buildWorkspacePayload(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    {
      ...params,
      ...(params.metadata && { metadata: withOwnedWorktreeClaim(params.metadata) }),
      agentId: params.agentId || null,
      groupId: params.groupId || null,
      id,
      sessionId: params.sessionId || null,
    },
  );

  const [topic] = await runTimedStage(
    timing,
    'db.topic.create.topics.insert',
    () => ctx.db.insert(topics).values(insertData).returning(),
    {
      hasAgentId: !!params.agentId,
      hasGroupId: !!params.groupId,
      hasSessionId: !!params.sessionId,
    },
  );

  if (topic?.projectId && topic.agentId)
    await joinTopicAgentsToProjects(ctx.db, { topicIds: [topic.id] });

  if (topic)
    announceTopicCreated(ctx.db, { userId: ctx.userId, workspaceId: ctx.workspaceId }, topic);

  return topic;
};

/** Tell the data layer's event outlet (developer webhooks) a topic now exists. */
export const announceTopicCreated = (
  db: Parameters<typeof emitDatabaseEvent>[0],
  scope: { userId: string; workspaceId?: string | null },
  topic: Pick<TopicItem, 'agentId' | 'id' | 'title'>,
) =>
  emitDatabaseEvent(db, scope, 'topic.created', {
    agentId: topic.agentId ?? null,
    title: topic.title ?? null,
    topicId: topic.id,
  });

/**
 * Batch-inserts topic rows, preserving input order in the returned rows.
 * Re-parenting messages onto them is owned by `TopicRepository.batchCreate`.
 */
export const batchInsert = async (
  ctx: TopicModelContext,
  topicParams: (Omit<CreateTopicParams, 'messages'> & { id?: string })[],
) => {
  const rows = await ctx.db
    .insert(topics)
    .values(
      topicParams.map((params) =>
        buildWorkspacePayload(
          { userId: ctx.userId, workspaceId: ctx.workspaceId },
          {
            agentId: params.agentId || null,
            favorite: params.favorite,
            groupId: params.sessionId ? null : params.groupId,
            id: params.id || ctx.genId(),
            sessionId: params.groupId ? null : params.sessionId,
            title: params.title,
            trigger: params.trigger,
          },
        ),
      ),
    )
    .returning();
  for (const topic of rows)
    announceTopicCreated(ctx.db, { userId: ctx.userId, workspaceId: ctx.workspaceId }, topic);
  return rows;
};
