import { and, count, eq, inArray, sql } from 'drizzle-orm';

import { AgentCopyJobModel, getAgentCopySyncMessageThreshold } from '../../models/agentCopyJob';
import { messages, threads, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { insertInBatches, splitCrossBatchSelfReferences } from '../../utils/batchInsert';
import { COPIED_TOPIC_USAGE_RESET } from '../../utils/copiedTranscript';
import { copyMessagesInDatabase, type IdPair } from '../../utils/copyMessagesInDatabase';
import { idGenerator } from '../../utils/idGenerator';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { AgentGroupScope } from './scope';

/**
 * Duplicate a group's conversations into the freshly created target group,
 * under the same fast/slow split as the agent copy path:
 *
 * - ≤ threshold — topics, threads and messages all copy inside the caller's
 *   transaction; behavior identical to the historical synchronous path.
 * - \> threshold — only the topic SHELLS are created here; thread + message
 *   duplication becomes a `copy` history job drained one topic at a time
 *   (see `AgentCopyJobModel`). Inserting a message row maintains every
 *   message index including the multi-GB BM25 one (~5ms/row in production),
 *   so a heavy group would otherwise hold a pooled connection for minutes.
 *
 * Returns the job id when the slow path was taken; the caller kicks the job
 * driver AFTER its transaction commits.
 */
export const copyGroupConversationHistory = async (
  scope: AgentGroupScope,
  {
    agentIdMap,
    executor,
    newGroupId,
    sourceGroupId,
    targetUserId,
    targetWorkspaceId,
  }: {
    agentIdMap: Map<string, string>;
    executor: LobeChatDatabase;
    newGroupId: string;
    sourceGroupId: string;
    targetUserId: string;
    targetWorkspaceId: string | null;
  },
): Promise<{ copyJobId: string | null }> => {
  const mapAgentId = (agentId?: null | string) =>
    agentId ? (agentIdMap.get(agentId) ?? null) : null;

  const sourceTopics = await executor.query.topics.findMany({
    orderBy: (topic, { asc }) => [asc(topic.createdAt)],
    where: and(scope.topicOwnership(), eq(topics.groupId, sourceGroupId)),
  });

  if (sourceTopics.length === 0) return { copyJobId: null };

  const sourceTopicIds = sourceTopics.map((topic) => topic.id);
  const topicIdMap = new Map(sourceTopics.map((topic) => [topic.id, idGenerator('topics')]));

  const [{ sourceMessages }] = await executor
    .select({ sourceMessages: count() })
    .from(messages)
    .where(and(scope.messageOwnership(), inArray(messages.topicId, sourceTopicIds)));

  // Topic shells go in on both paths — they are what makes the copied group
  // usable immediately, and what the queue rows / gray-out UI key on.
  await insertInBatches(
    sourceTopics.map((topic) => ({
      ...topic,
      ...COPIED_TOPIC_USAGE_RESET,
      agentId: mapAgentId(topic.agentId),
      clientId: null,
      groupId: newGroupId,
      id: topicIdMap.get(topic.id),
      sessionId: null,
      userId: targetUserId,
      workspaceId: targetWorkspaceId,
    })),
    (batch) => executor.insert(topics).values(batch),
  );

  if (sourceMessages > getAgentCopySyncMessageThreshold()) {
    const copyJobId = await AgentCopyJobModel.createJob(executor, {
      agents: [...agentIdMap.entries()].map(([sourceAgentId, newAgentId]) => ({
        newAgentId,
        sourceAgentId,
      })),
      group: { newGroupId, sourceGroupId },
      source: { userId: scope.userId, workspaceId: scope.workspaceId ?? null },
      target: { userId: targetUserId, workspaceId: targetWorkspaceId },
      topics: sourceTopics.map((topic) => ({
        activityAt: topic.updatedAt ?? topic.createdAt ?? new Date(),
        newTopicId: topicIdMap.get(topic.id)!,
        sourceTopicId: topic.id,
      })),
    });
    return { copyJobId };
  }

  const sourceThreads = await executor.query.threads.findMany({
    orderBy: (thread, { asc }) => [asc(thread.createdAt)],
    where: and(scope.threadOwnership(), inArray(threads.topicId, sourceTopicIds)),
  });

  const threadIdMap = new Map(
    sourceThreads.map((thread) => [thread.id, idGenerator('threads', 16)]),
  );

  // Message bodies never leave the database — only the ids are fetched to
  // build the remap tables consumed by the in-database copy below (threads
  // also need the complete message map for `sourceMessageId`).
  const messageIdPairs: IdPair[] = (
    await executor.query.messages.findMany({
      columns: { id: true },
      where: and(scope.messageOwnership(), inArray(messages.topicId, sourceTopicIds)),
    })
  ).map(({ id }) => [id, idGenerator('messages')]);

  const messageIdMap = new Map(messageIdPairs);

  if (sourceThreads.length > 0) {
    const { fixups: threadFixups, rows: threadRows } = splitCrossBatchSelfReferences(
      sourceThreads.map((thread) => ({
        ...thread,
        agentId: mapAgentId(thread.agentId),
        clientId: null,
        groupId: newGroupId,
        id: threadIdMap.get(thread.id)!,
        parentThreadId: thread.parentThreadId
          ? (threadIdMap.get(thread.parentThreadId) ?? null)
          : null,
        sourceMessageId: thread.sourceMessageId
          ? (messageIdMap.get(thread.sourceMessageId) ?? null)
          : null,
        topicId: topicIdMap.get(thread.topicId),
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      })),
      ['parentThreadId'],
    );

    await insertInBatches(threadRows, (batch) => executor.insert(threads).values(batch));

    for (const fixup of threadFixups) {
      await executor.update(threads).set(fixup.patch).where(eq(threads.id, fixup.id));
    }
  }

  // `agent_id` remaps through the group-member map (unknown → NULL);
  // `target_id` keeps the literal 'user' and remaps agent targets the same way.
  await copyMessagesInDatabase({
    agentIdExpr: sql`_amap.new_id`,
    agentIdPairs: [...agentIdMap.entries()],
    executor,
    groupId: newGroupId,
    messageIdPairs,
    childScope: (table) =>
      buildWorkspaceWhere({ userId: scope.userId, workspaceId: scope.workspaceId }, table),
    targetIdExpr: sql`case when ${messages.targetId} = 'user' then ${messages.targetId} else _amap_target.new_id end`,
    targetUserId,
    targetWorkspaceId,
    threadIdPairs: [...threadIdMap.entries()],
    topicIdPairs: [...topicIdMap.entries()],
  });

  return { copyJobId: null };
};
