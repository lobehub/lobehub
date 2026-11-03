import { runTimedSinkStage as runTimedStage } from '@lobechat/utils';

import { type TopicItem, topics } from '../../schemas';
import { joinTopicAgentsToProjects } from '../../utils/projectTopicAgents';
import { buildWorkspacePayload } from '../../utils/workspace';
import type { TopicModelContext } from './context';
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

  return topic;
};

/**
 * Batch-inserts topic rows, preserving input order in the returned rows.
 * Re-parenting messages onto them is owned by `TopicRepository.batchCreate`.
 */
export const batchInsert = async (
  ctx: TopicModelContext,
  topicParams: (Omit<CreateTopicParams, 'messages'> & { id?: string })[],
) =>
  ctx.db
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
