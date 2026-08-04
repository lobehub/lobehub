// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentBotProviders,
  agentCronJobs,
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  agentsToSessions,
  briefs,
  chatGroups,
  chatGroupsAgents,
  documents,
  files,
  knowledgeBases,
  messageGroups,
  messagePlugins,
  messages,
  sessionGroups,
  sessions,
  taskComments,
  taskDependencies,
  taskDocuments,
  tasks,
  taskTopics,
  threads,
  topicCommentMentions,
  topicComments,
  topics,
  users,
  workspaceMembers,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  buildMessageChildScopeWhere,
  MESSAGE_TRANSFER_HAS_FOREIGN_AUTHORS,
} from '../../utils/messageScope';
import { AgentModel } from '../agent';
import { MessageModel } from '../message';
import {
  TOPIC_COMMENT_TOPIC_NOT_FOUND,
  TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS,
  TopicCommentModel,
} from '../topicComment';
import { UserModel } from '../user';
import { WorkspaceModel } from '../workspace';

const serverDB: LobeChatDatabase = await getTestDB();
const isServerDB = process.env.TEST_SERVER_DB === '1';

const userId = 'transfer-test-user';
const targetUserId = 'transfer-test-target-user';
const wsId1 = 'transfer-test-ws-1';
const wsId2 = 'transfer-test-ws-2';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: targetUserId }]);
  await serverDB.insert(workspaces).values([
    { id: wsId1, name: 'WS 1', slug: 'ws-1', primaryOwnerId: userId },
    { id: wsId2, name: 'WS 2', slug: 'ws-2', primaryOwnerId: targetUserId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel.transferAgent', () => {
  it('should transfer agent from personal to workspace', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Test Agent', slug: 'test-agent' });

    const result = await model.transferAgent(agent.id, wsId1, userId);

    expect(result.agentId).toBe(agent.id);

    const updated = await serverDB.query.agents.findFirst({
      where: eq(agents.id, agent.id),
    });
    expect(updated?.workspaceId).toBe(wsId1);
    expect(updated?.userId).toBe(userId);
  });

  it('should transfer agent from workspace to personal', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'WS Agent', slug: 'ws-agent' });

    const result = await model.transferAgent(agent.id, null, userId);

    expect(result.agentId).toBe(agent.id);

    const updated = await serverDB.query.agents.findFirst({
      where: eq(agents.id, agent.id),
    });
    expect(updated?.workspaceId).toBeNull();
    expect(updated?.userId).toBe(userId);
  });

  it('should transfer agent between workspaces', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'WS1 Agent', slug: 'ws1-agent' });

    const result = await model.transferAgent(agent.id, wsId2, userId);

    expect(result.agentId).toBe(agent.id);

    const updated = await serverDB.query.agents.findFirst({
      where: eq(agents.id, agent.id),
    });
    expect(updated?.workspaceId).toBe(wsId2);
  });

  it('should handle slug conflict by appending suffix', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent1 = await model.create({ title: 'Agent', slug: 'my-agent' });

    // Create an agent with the same slug in target workspace
    const model2 = new AgentModel(serverDB, userId, wsId2);
    await model2.create({ title: 'Existing Agent', slug: 'my-agent' });

    const result = await model.transferAgent(agent1.id, wsId2, userId);

    expect(result.slug).toBe('my-agent-1');

    const updated = await serverDB.query.agents.findFirst({
      where: eq(agents.id, agent1.id),
    });
    expect(updated?.slug).toBe('my-agent-1');
  });

  it('should update related sessions and agentsToSessions', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Agent' });

    // Create a session linked to the agent
    await serverDB.insert(sessions).values({ id: 'sess-1', userId, type: 'agent' });
    await serverDB
      .insert(agentsToSessions)
      .values({ agentId: agent.id, sessionId: 'sess-1', userId });

    await model.transferAgent(agent.id, wsId1, userId);

    const [session] = await serverDB.select().from(sessions).where(eq(sessions.id, 'sess-1'));
    expect(session.workspaceId).toBe(wsId1);

    const [link] = await serverDB
      .select()
      .from(agentsToSessions)
      .where(eq(agentsToSessions.agentId, agent.id));
    expect(link.workspaceId).toBe(wsId1);
  });

  it('should clear stale session group references on transfer', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Grouped Agent' });

    // Personal-scope sidebar folder the agent and its session lived in
    await serverDB.insert(sessionGroups).values({ id: 'sg-personal', name: 'Folder', userId });
    await serverDB
      .update(agents)
      .set({ sessionGroupId: 'sg-personal' })
      .where(eq(agents.id, agent.id));
    await serverDB
      .insert(sessions)
      .values({ id: 'sess-grouped', userId, type: 'agent', groupId: 'sg-personal' });
    await serverDB
      .insert(agentsToSessions)
      .values({ agentId: agent.id, sessionId: 'sess-grouped', userId });

    await model.transferAgent(agent.id, wsId1, userId, 'private');

    const updated = await serverDB.query.agents.findFirst({ where: eq(agents.id, agent.id) });
    expect(updated?.sessionGroupId).toBeNull();

    const [session] = await serverDB.select().from(sessions).where(eq(sessions.id, 'sess-grouped'));
    expect(session.groupId).toBeNull();
  });

  it('should update topics and keep messages as untouched snapshots visible via derivation', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Agent' });

    await serverDB.insert(topics).values({ id: 'topic-1', agentId: agent.id, userId });
    await serverDB
      .insert(messages)
      .values({ id: 'msg-1', agentId: agent.id, topicId: 'topic-1', userId, role: 'assistant' });

    await model.transferAgent(agent.id, wsId1, userId);

    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, 'topic-1'));
    expect(topic.workspaceId).toBe(wsId1);

    // The message row itself is NOT rewritten: user_id/workspace_id stay as
    // creation-time snapshots (avoids the minutes-long BM25/index write
    // amplification on heavy agents)…
    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'msg-1'));
    expect(msg.workspaceId).toBeNull();
    expect(msg.userId).toBe(userId);

    // …while scope derivation makes it immediately visible in the target
    // workspace, and no longer visible in the source personal scope.
    const wsMessages = new MessageModel(serverDB, userId, wsId1);
    expect(await wsMessages.query({ topicId: 'topic-1' })).toHaveLength(1);

    const personalMessages = new MessageModel(serverDB, userId);
    expect(await personalMessages.query({ topicId: 'topic-1' })).toHaveLength(0);
  });

  it('should keep message child tables (plugins) visible after transfer and round-trip cleanly', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Agent' });

    await serverDB.insert(topics).values({ id: 'rt-topic', agentId: agent.id, userId });
    await serverDB.insert(messages).values({
      agentId: agent.id,
      id: 'rt-msg-tool',
      role: 'tool',
      topicId: 'rt-topic',
      userId,
    });
    await serverDB.insert(messagePlugins).values({
      id: 'rt-msg-tool',
      identifier: 'test-plugin',
      toolCallId: 'call-1',
      userId,
    });

    const pluginVisibleIn = async (workspaceId?: string) =>
      serverDB
        .select({ id: messagePlugins.id })
        .from(messagePlugins)
        .where(
          and(
            eq(messagePlugins.id, 'rt-msg-tool'),
            buildMessageChildScopeWhere({ userId, workspaceId }, messagePlugins.id),
          ),
        );

    // personal → workspace: message and plugin payload reachable in the
    // workspace scope even though neither row was rewritten
    await model.transferAgent(agent.id, wsId1, userId);
    const wsMessages = new MessageModel(serverDB, userId, wsId1);
    expect(await wsMessages.query({ topicId: 'rt-topic' })).toHaveLength(1);
    expect(await pluginVisibleIn(wsId1)).toHaveLength(1);
    expect(await pluginVisibleIn(undefined)).toHaveLength(0);

    // workspace → personal round-trip: everything visible again in personal scope
    const wsModel = new AgentModel(serverDB, userId, wsId1);
    await wsModel.transferAgent(agent.id, null, userId);
    const personalMessages = new MessageModel(serverDB, userId);
    expect(await personalMessages.query({ topicId: 'rt-topic' })).toHaveLength(1);
    expect(await pluginVisibleIn(undefined)).toHaveLength(1);

    // author snapshot is never rewritten
    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'rt-msg-tool'));
    expect(msg.userId).toBe(userId);
  });

  it('should rewrite anchorless agent messages (no topic/session) on transfer', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Agent' });

    // Anchorless: linked only via agentId — snapshot IS the authoritative scope
    await serverDB
      .insert(messages)
      .values({ agentId: agent.id, id: 'anchorless-msg', role: 'assistant', userId });

    await model.transferAgent(agent.id, wsId1, userId);

    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'anchorless-msg'));
    expect(msg).toMatchObject({ userId, workspaceId: wsId1 });
  });

  it('should preserve content timestamps while transferring ownership', async () => {
    const originalUpdatedAt = new Date('2024-01-02T03:04:05.000Z');
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Historical Agent' });

    await serverDB
      .update(agents)
      .set({ updatedAt: originalUpdatedAt })
      .where(eq(agents.id, agent.id));
    await serverDB.insert(sessions).values({
      id: 'timestamp-session',
      type: 'agent',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(agentsToSessions).values({
      agentId: agent.id,
      sessionId: 'timestamp-session',
      userId,
    });
    await serverDB.insert(topics).values({
      agentId: agent.id,
      id: 'timestamp-topic',
      sessionId: 'timestamp-session',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(messages).values({
      agentId: agent.id,
      id: 'timestamp-message',
      role: 'assistant',
      sessionId: 'timestamp-session',
      topicId: 'timestamp-topic',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(threads).values({
      agentId: agent.id,
      id: 'timestamp-thread',
      topicId: 'timestamp-topic',
      type: 'continuation',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(files).values({
      fileType: 'text/plain',
      id: 'timestamp-file',
      name: 'historical.txt',
      size: 1,
      url: 'https://example.com/historical.txt',
      userId,
    });
    await serverDB.insert(agentsFiles).values({
      agentId: agent.id,
      fileId: 'timestamp-file',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(knowledgeBases).values({
      id: 'timestamp-kb',
      name: 'Historical Knowledge Base',
      userId,
    });
    await serverDB.insert(agentsKnowledgeBases).values({
      agentId: agent.id,
      knowledgeBaseId: 'timestamp-kb',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(agentCronJobs).values({
      agentId: agent.id,
      content: 'Run later',
      cronPattern: '0 * * * *',
      id: 'timestamp-cron',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(tasks).values({
      assigneeAgentId: agent.id,
      createdByUserId: userId,
      id: 'timestamp-task',
      identifier: 'T-timestamp',
      instruction: 'Keep the original recency',
      seq: 1,
      updatedAt: originalUpdatedAt,
    });
    await serverDB.insert(taskTopics).values({
      seq: 1,
      status: 'completed',
      taskId: 'timestamp-task',
      topicId: 'timestamp-topic',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(taskComments).values({
      content: 'Historical comment',
      id: 'timestamp-comment',
      taskId: 'timestamp-task',
      updatedAt: originalUpdatedAt,
      userId,
    });
    await serverDB.insert(agentBotProviders).values({
      agentId: agent.id,
      applicationId: 'timestamp-app',
      platform: 'discord',
      updatedAt: originalUpdatedAt,
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId, 'private');

    const timestampRows = await Promise.all([
      serverDB.select({ updatedAt: agents.updatedAt }).from(agents).where(eq(agents.id, agent.id)),
      serverDB
        .select({ updatedAt: sessions.updatedAt })
        .from(sessions)
        .where(eq(sessions.id, 'timestamp-session')),
      serverDB
        .select({ updatedAt: topics.updatedAt })
        .from(topics)
        .where(eq(topics.id, 'timestamp-topic')),
      serverDB
        .select({ updatedAt: messages.updatedAt })
        .from(messages)
        .where(eq(messages.id, 'timestamp-message')),
      serverDB
        .select({ updatedAt: threads.updatedAt })
        .from(threads)
        .where(eq(threads.id, 'timestamp-thread')),
      serverDB
        .select({ updatedAt: agentsFiles.updatedAt })
        .from(agentsFiles)
        .where(eq(agentsFiles.agentId, agent.id)),
      serverDB
        .select({ updatedAt: agentsKnowledgeBases.updatedAt })
        .from(agentsKnowledgeBases)
        .where(eq(agentsKnowledgeBases.agentId, agent.id)),
      serverDB
        .select({ updatedAt: agentCronJobs.updatedAt })
        .from(agentCronJobs)
        .where(eq(agentCronJobs.id, 'timestamp-cron')),
      serverDB
        .select({ updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(eq(tasks.id, 'timestamp-task')),
      serverDB
        .select({ updatedAt: taskTopics.updatedAt })
        .from(taskTopics)
        .where(eq(taskTopics.taskId, 'timestamp-task')),
      serverDB
        .select({ updatedAt: taskComments.updatedAt })
        .from(taskComments)
        .where(eq(taskComments.id, 'timestamp-comment')),
      serverDB
        .select({ updatedAt: agentBotProviders.updatedAt })
        .from(agentBotProviders)
        .where(eq(agentBotProviders.agentId, agent.id)),
    ]);

    expect(timestampRows).toHaveLength(12);
    for (const [row] of timestampRows) expect(row.updatedAt).toEqual(originalUpdatedAt);

    const [transferredAgent] = await serverDB
      .select({ workspaceId: agents.workspaceId })
      .from(agents)
      .where(eq(agents.id, agent.id));
    expect(transferredAgent.workspaceId).toBe(wsId1);
  });

  it('should move topic comments and mentions with the topic between workspaces', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'Commented Agent' });
    const originalCommentUpdatedAt = new Date('2024-01-02T03:04:05.000Z');

    await serverDB
      .insert(topics)
      .values({ id: 'comment-topic-1', agentId: agent.id, userId, workspaceId: wsId1 });
    await serverDB.insert(topicComments).values({
      authorUserId: userId,
      clientId: 'comment-client-1',
      content: 'team note',
      id: 'tcm-move-1',
      topicId: 'comment-topic-1',
      updatedAt: originalCommentUpdatedAt,
      workspaceId: wsId1,
    });
    await serverDB.insert(topicCommentMentions).values({
      commentId: 'tcm-move-1',
      mentionedUserId: targetUserId,
      workspaceId: wsId1,
    });

    await model.transferAgent(agent.id, wsId2, targetUserId);

    const [comment] = await serverDB
      .select()
      .from(topicComments)
      .where(eq(topicComments.id, 'tcm-move-1'));
    const [mention] = await serverDB
      .select()
      .from(topicCommentMentions)
      .where(eq(topicCommentMentions.commentId, 'tcm-move-1'));
    expect(comment.workspaceId).toBe(wsId2);
    expect(comment.updatedAt).toEqual(originalCommentUpdatedAt);
    expect(mention.workspaceId).toBe(wsId2);
  });

  it('should delete topic comments when transferring to personal scope', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'Commented Agent 2' });

    await serverDB
      .insert(topics)
      .values({ id: 'comment-topic-2', agentId: agent.id, userId, workspaceId: wsId1 });
    await serverDB.insert(topicComments).values({
      authorUserId: userId,
      clientId: 'comment-client-root',
      content: 'root',
      id: 'tcm-root',
      topicId: 'comment-topic-2',
      workspaceId: wsId1,
    });
    await serverDB.insert(topicComments).values({
      authorUserId: userId,
      clientId: 'comment-client-reply',
      content: 'reply',
      id: 'tcm-reply',
      parentCommentId: 'tcm-root',
      topicId: 'comment-topic-2',
      workspaceId: wsId1,
    });
    await serverDB.insert(topicCommentMentions).values({
      commentId: 'tcm-root',
      mentionedUserId: targetUserId,
      workspaceId: wsId1,
    });

    await model.transferAgent(agent.id, null, userId);

    // Personal topics cannot hold comments (NOT NULL workspaceId) — the whole
    // thread (root + reply) is removed and mention rows cascade with it
    const remaining = await serverDB
      .select()
      .from(topicComments)
      .where(eq(topicComments.topicId, 'comment-topic-2'));
    const mentions = await serverDB
      .select()
      .from(topicCommentMentions)
      .where(eq(topicCommentMentions.commentId, 'tcm-root'));
    expect(remaining).toHaveLength(0);
    expect(mentions).toHaveLength(0);
  });

  it('should flag teammate-authored and orphaned comments as foreign rows', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'Guarded Agent' });

    await serverDB
      .insert(topics)
      .values({ id: 'guard-topic', agentId: agent.id, userId, workspaceId: wsId1 });

    // Caller's own comment — not foreign
    await serverDB.insert(topicComments).values({
      authorUserId: userId,
      clientId: 'guard-own',
      content: 'my own note',
      id: 'tcm-guard-own',
      topicId: 'guard-topic',
      workspaceId: wsId1,
    });
    expect(await model.transferHasForeignRows(agent.id)).toBe(false);

    // A teammate's comment on the caller's own topic — foreign
    await serverDB.insert(topicComments).values({
      authorUserId: targetUserId,
      clientId: 'guard-teammate',
      content: 'teammate note',
      id: 'tcm-guard-teammate',
      topicId: 'guard-topic',
      workspaceId: wsId1,
    });
    expect(await model.transferHasForeignRows(agent.id)).toBe(true);

    // Orphaned comment (author account deleted ⇒ NULL) — still not the
    // caller's work; ne() alone would silently skip it
    await serverDB.delete(topicComments).where(eq(topicComments.id, 'tcm-guard-teammate'));
    await serverDB.insert(topicComments).values({
      authorUserId: null,
      clientId: 'guard-orphan',
      content: 'orphaned note',
      id: 'tcm-guard-orphan',
      topicId: 'guard-topic',
      workspaceId: wsId1,
    });
    expect(await model.transferHasForeignRows(agent.id)).toBe(true);
  });

  it('should flag topic-only teammate messages and message groups as foreign rows', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'Anchor Guarded Agent' });

    await serverDB
      .insert(topics)
      .values({ id: 'anchor-guard-topic', agentId: agent.id, userId, workspaceId: wsId1 });

    // Caller's own topic-only message — not foreign
    await serverDB.insert(messages).values({
      id: 'anchor-guard-own',
      role: 'user',
      topicId: 'anchor-guard-topic',
      userId,
      workspaceId: wsId1,
    });
    expect(await model.transferHasForeignRows(agent.id)).toBe(false);

    // A teammate's message carrying ONLY a topicId (the OpenAPI create shape:
    // agentId optional, sessionId always null) follows the transferred topic
    // under derived scope — the session/agent probes alone cannot see it
    await serverDB.insert(messages).values({
      id: 'anchor-guard-teammate',
      role: 'user',
      topicId: 'anchor-guard-topic',
      userId: targetUserId,
      workspaceId: wsId1,
    });
    expect(await model.transferHasForeignRows(agent.id)).toBe(true);

    // Same for a teammate's message group anchored to the caller's topic
    await serverDB.delete(messages).where(eq(messages.id, 'anchor-guard-teammate'));
    expect(await model.transferHasForeignRows(agent.id)).toBe(false);
    await serverDB.insert(messageGroups).values({
      id: 'anchor-guard-group',
      topicId: 'anchor-guard-topic',
      userId: targetUserId,
      workspaceId: wsId1,
    });
    expect(await model.transferHasForeignRows(agent.id)).toBe(true);
  });

  it('should recheck topic-anchored teammate rows inside the transfer transaction', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'Locked Guard Agent' });

    await serverDB
      .insert(topics)
      .values({ id: 'locked-guard-topic', agentId: agent.id, userId, workspaceId: wsId1 });

    // Simulates the TOCTOU window: the teammate row already exists by the
    // time the transaction rechecks under the topic lock (the router-side
    // transferHasForeignRows precheck is deliberately skipped here).
    await serverDB.insert(messages).values({
      id: 'locked-guard-msg',
      role: 'user',
      topicId: 'locked-guard-topic',
      userId: targetUserId,
      workspaceId: wsId1,
    });

    await expect(
      model.transferAgent(agent.id, null, userId, undefined, {
        rejectForeignMessageAuthors: true,
      }),
    ).rejects.toThrow(MESSAGE_TRANSFER_HAS_FOREIGN_AUTHORS);

    // The rejection rolled the whole transfer back
    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, 'locked-guard-topic'));
    expect(topic.workspaceId).toBe(wsId1);

    // Without foreign rows the same flag lets the transfer through
    await serverDB.delete(messages).where(eq(messages.id, 'locked-guard-msg'));
    await expect(
      model.transferAgent(agent.id, null, userId, undefined, {
        rejectForeignMessageAuthors: true,
      }),
    ).resolves.toBeTruthy();
  });

  it.skipIf(!isServerDB)(
    'should serialize comment creation with the authoritative transfer check',
    async () => {
      const trials = 10;

      for (let i = 0; i < trials; i++) {
        const model = new AgentModel(serverDB, userId, wsId1);
        const commenterModel = new TopicCommentModel(serverDB, targetUserId, wsId1);
        const agent = await model.create({ title: `Race Agent ${i}` });
        const topicId = `transfer-comment-race-topic-${i}`;
        await serverDB.insert(topics).values({
          agentId: agent.id,
          id: topicId,
          userId,
          workspaceId: wsId1,
        });

        const outcomes = await Promise.allSettled([
          model.transferAgent(agent.id, wsId2, userId, undefined, {
            rejectForeignTopicCommentAuthors: true,
          }),
          commenterModel.createWithMentions({
            clientId: `transfer-comment-race-${i}`,
            content: 'concurrent teammate comment',
            topicId,
          }),
        ]);

        expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
        const rejection = outcomes.find(
          (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
        );
        expect([
          TOPIC_COMMENT_TOPIC_NOT_FOUND,
          TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS,
        ]).toContain(rejection?.reason.message);
      }
    },
  );

  it('should update bot providers', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Agent' });

    await serverDB.insert(agentBotProviders).values({
      agentId: agent.id,
      userId,
      platform: 'discord',
      applicationId: 'app-1',
      credentials: 'encrypted-creds',
    });

    await model.transferAgent(agent.id, wsId1, userId);

    const [bot] = await serverDB
      .select()
      .from(agentBotProviders)
      .where(eq(agentBotProviders.agentId, agent.id));
    expect(bot.workspaceId).toBe(wsId1);
    expect(bot.userId).toBe(userId);
  });

  it('should transfer tasks assigned to the agent and their child records', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'Task Agent' });

    await serverDB.insert(tasks).values([
      {
        assigneeAgentId: agent.id,
        automationMode: 'schedule',
        createdByAgentId: agent.id,
        createdByUserId: userId,
        id: 'task-assigned-to-agent',
        identifier: 'T-1',
        instruction: 'Run scheduled work',
        schedulePattern: '0 * * * *',
        seq: 1,
        workspaceId: wsId1,
      },
      {
        createdByUserId: userId,
        id: 'task-blocker',
        identifier: 'T-2',
        instruction: 'External blocker',
        seq: 2,
        workspaceId: wsId1,
      },
    ]);
    await serverDB.insert(taskDependencies).values({
      dependsOnId: 'task-blocker',
      taskId: 'task-assigned-to-agent',
      type: 'blocks',
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(documents).values({
      content: '',
      fileType: 'text/plain',
      id: 'task-doc',
      source: 'test',
      sourceType: 'file',
      title: 'Task doc',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(taskDocuments).values({
      documentId: 'task-doc',
      taskId: 'task-assigned-to-agent',
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(topics).values({
      id: 'task-topic',
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(taskTopics).values({
      seq: 1,
      status: 'completed',
      taskId: 'task-assigned-to-agent',
      topicId: 'task-topic',
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(briefs).values({
      agentId: agent.id,
      id: 'task-brief',
      summary: 'Done',
      taskId: 'task-assigned-to-agent',
      title: 'Result',
      type: 'result',
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(taskComments).values({
      authorAgentId: agent.id,
      content: 'Comment',
      id: 'task-comment',
      taskId: 'task-assigned-to-agent',
      userId,
      workspaceId: wsId1,
    });

    await model.transferAgent(agent.id, wsId2, targetUserId);

    const [task] = await serverDB
      .select()
      .from(tasks)
      .where(eq(tasks.id, 'task-assigned-to-agent'));
    expect(task.createdByUserId).toBe(targetUserId);
    expect(task.workspaceId).toBe(wsId2);
    expect(task.assigneeAgentId).toBe(agent.id);
    expect(task.createdByAgentId).toBe(agent.id);

    const [dependency] = await serverDB
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, 'task-assigned-to-agent'));
    expect(dependency.userId).toBe(targetUserId);
    expect(dependency.workspaceId).toBe(wsId2);

    const [taskDocument] = await serverDB
      .select()
      .from(taskDocuments)
      .where(eq(taskDocuments.taskId, 'task-assigned-to-agent'));
    expect(taskDocument.userId).toBe(targetUserId);
    expect(taskDocument.workspaceId).toBe(wsId2);

    const [taskTopic] = await serverDB
      .select()
      .from(taskTopics)
      .where(eq(taskTopics.taskId, 'task-assigned-to-agent'));
    expect(taskTopic.userId).toBe(targetUserId);
    expect(taskTopic.workspaceId).toBe(wsId2);

    const [brief] = await serverDB
      .select()
      .from(briefs)
      .where(eq(briefs.taskId, 'task-assigned-to-agent'));
    expect(brief.userId).toBe(targetUserId);
    expect(brief.workspaceId).toBe(wsId2);

    const [comment] = await serverDB
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, 'task-assigned-to-agent'));
    expect(comment.userId).toBe(targetUserId);
    expect(comment.workspaceId).toBe(wsId2);
  });

  it('should cascade targetVisibility to moved tasks and their child rows', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Personal Agent' });

    await serverDB.insert(tasks).values({
      createdByAgentId: agent.id,
      createdByUserId: userId,
      id: 'task-vis',
      identifier: 'T-vis',
      instruction: 'Do the thing',
      seq: 1,
      // Row starts at the schema default `visibility='public'`, which is
      // ignored in personal scope but honored once moved into a workspace.
    });
    await serverDB.insert(tasks).values({
      createdByUserId: userId,
      id: 'task-vis-blocker',
      identifier: 'T-vis-blocker',
      instruction: 'Blocker',
      seq: 2,
    });
    await serverDB.insert(taskDependencies).values({
      dependsOnId: 'task-vis-blocker',
      taskId: 'task-vis',
      type: 'blocks',
      userId,
    });
    await serverDB.insert(documents).values({
      content: '',
      fileType: 'text/plain',
      id: 'task-vis-doc',
      source: 'test',
      sourceType: 'file',
      title: 'Doc',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    });
    await serverDB.insert(taskDocuments).values({
      documentId: 'task-vis-doc',
      taskId: 'task-vis',
      userId,
    });
    await serverDB.insert(topics).values({ id: 'task-vis-topic', userId });
    await serverDB.insert(taskTopics).values({
      seq: 1,
      status: 'completed',
      taskId: 'task-vis',
      topicId: 'task-vis-topic',
      userId,
    });
    await serverDB.insert(taskComments).values({
      authorAgentId: agent.id,
      content: 'Comment',
      id: 'task-vis-comment',
      taskId: 'task-vis',
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId, 'private');

    const [task] = await serverDB.select().from(tasks).where(eq(tasks.id, 'task-vis'));
    expect(task.workspaceId).toBe(wsId1);
    expect(task.visibility).toBe('private');

    const [dep] = await serverDB
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, 'task-vis'));
    expect(dep.visibility).toBe('private');

    const [doc] = await serverDB
      .select()
      .from(taskDocuments)
      .where(eq(taskDocuments.taskId, 'task-vis'));
    expect(doc.visibility).toBe('private');

    const [topic] = await serverDB
      .select()
      .from(taskTopics)
      .where(eq(taskTopics.taskId, 'task-vis'));
    expect(topic.visibility).toBe('private');

    const [comment] = await serverDB
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, 'task-vis'));
    expect(comment.visibility).toBe('private');
  });

  it('should not touch visibility when moving to personal scope', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'WS Agent' });

    await serverDB.insert(tasks).values({
      createdByAgentId: agent.id,
      createdByUserId: userId,
      id: 'task-personal',
      identifier: 'T-personal',
      instruction: 'Task',
      seq: 1,
      visibility: 'public',
      workspaceId: wsId1,
    });

    await model.transferAgent(agent.id, null, userId, 'private');

    const [task] = await serverDB.select().from(tasks).where(eq(tasks.id, 'task-personal'));
    expect(task.workspaceId).toBeNull();
    // targetVisibility is a no-op when the destination is personal scope.
    expect(task.visibility).toBe('public');
  });

  it('should remove chat group associations', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Agent' });

    await serverDB.insert(chatGroups).values({ id: 'group-1', userId });
    await serverDB
      .insert(chatGroupsAgents)
      .values({ chatGroupId: 'group-1', agentId: agent.id, userId });

    await model.transferAgent(agent.id, wsId1, userId);

    const groupLinks = await serverDB
      .select()
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.agentId, agent.id));
    expect(groupLinks).toHaveLength(0);
  });

  it('should throw when agent not found', async () => {
    const model = new AgentModel(serverDB, userId);
    await expect(model.transferAgent('nonexistent', wsId1, userId)).rejects.toThrow(
      'Agent not found',
    );
  });
});

describe('owner deletion after transfer (snapshot re-materialization)', () => {
  it('deleting the source workspace must not cascade away transferred messages', async () => {
    const wsModel = new AgentModel(serverDB, userId, wsId1);
    const agent = await wsModel.create({ title: 'WS Agent' });

    await serverDB
      .insert(topics)
      .values({ id: 'del-ws-topic', agentId: agent.id, userId, workspaceId: wsId1 });
    await serverDB.insert(messages).values([
      {
        agentId: agent.id,
        id: 'del-ws-msg',
        role: 'tool',
        topicId: 'del-ws-topic',
        userId,
        workspaceId: wsId1,
      },
      // control: stays anchored in ws1 and must die with the workspace
      { id: 'del-ws-stay', role: 'user', userId, workspaceId: wsId1 },
    ]);
    await serverDB.insert(messagePlugins).values({
      id: 'del-ws-msg',
      identifier: 'test-plugin',
      toolCallId: 'call-del',
      userId,
      workspaceId: wsId1,
    });

    await wsModel.transferAgent(agent.id, null, userId);
    await new WorkspaceModel(serverDB, userId).delete(wsId1);

    // Transferred message + child row survive, re-snapshotted to the anchor's
    // current (personal) scope…
    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'del-ws-msg'));
    expect(msg).toMatchObject({ userId, workspaceId: null });
    const [plugin] = await serverDB
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, 'del-ws-msg'));
    expect(plugin).toMatchObject({ userId, workspaceId: null });

    // …and stay readable through scope derivation.
    const personalMessages = new MessageModel(serverDB, userId);
    expect(await personalMessages.query({ topicId: 'del-ws-topic' })).toHaveLength(1);

    // The orphan row that still belonged to the workspace is gone.
    const stay = await serverDB.select().from(messages).where(eq(messages.id, 'del-ws-stay'));
    expect(stay).toHaveLength(0);
  });

  it('deleting a workspace primary owner must not cascade away histories transferred out of their workspaces', async () => {
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'member', userId: targetUserId, workspaceId: wsId1 });

    const wsModel = new AgentModel(serverDB, userId, wsId1);
    const agent = await wsModel.create({ title: 'WS Agent' });

    await serverDB
      .insert(topics)
      .values({ id: 'del-owner-topic', agentId: agent.id, userId, workspaceId: wsId1 });
    // Authored by the teammate: snapshot is (targetUserId, wsId1) — the
    // user-keyed scrub for the deleted owner would never touch this row.
    await serverDB.insert(messages).values({
      agentId: agent.id,
      id: 'del-owner-msg',
      role: 'user',
      topicId: 'del-owner-topic',
      userId: targetUserId,
      workspaceId: wsId1,
    });

    // Move the agent into the teammate's personal scope, then delete the
    // workspace primary owner — which cascades wsId1 itself.
    await wsModel.transferAgent(agent.id, null, targetUserId);
    await UserModel.deleteUser(serverDB, userId);

    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'del-owner-msg'));
    expect(msg).toMatchObject({ userId: targetUserId, workspaceId: null });

    const teammateMessages = new MessageModel(serverDB, targetUserId);
    expect(await teammateMessages.query({ topicId: 'del-owner-topic' })).toHaveLength(1);
  });

  it('deleting the old author must not cascade away messages transferred to another scope', async () => {
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'member', userId: targetUserId, workspaceId: wsId1 });

    const wsModel = new AgentModel(serverDB, userId, wsId1);
    const agent = await wsModel.create({ title: 'WS Agent' });

    await serverDB
      .insert(topics)
      .values({ id: 'del-user-topic', agentId: agent.id, userId, workspaceId: wsId1 });
    await serverDB.insert(messages).values([
      // authored by the teammate inside the workspace
      {
        agentId: agent.id,
        id: 'del-user-msg',
        role: 'user',
        topicId: 'del-user-topic',
        userId: targetUserId,
        workspaceId: wsId1,
      },
      // control: the teammate's own personal message still cascades away
      { id: 'del-user-personal', role: 'user', userId: targetUserId },
    ]);

    // Move the agent (and its topic) into the OTHER user's personal scope,
    // then delete the teammate who authored part of the history.
    await wsModel.transferAgent(agent.id, null, userId);
    await UserModel.deleteUser(serverDB, targetUserId);

    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'del-user-msg'));
    expect(msg).toMatchObject({ userId, workspaceId: null });

    const personalMessages = new MessageModel(serverDB, userId);
    expect(await personalMessages.query({ topicId: 'del-user-topic' })).toHaveLength(1);

    const gone = await serverDB.select().from(messages).where(eq(messages.id, 'del-user-personal'));
    expect(gone).toHaveLength(0);
  });
});

describe('AgentModel.transferAgents (batch)', () => {
  it('should transfer multiple agents with their topics and messages in one call', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent1 = await model.create({ title: 'Agent 1' });
    const agent2 = await model.create({ title: 'Agent 2' });

    await serverDB.insert(topics).values([
      { id: 'batch-topic-1', agentId: agent1.id, userId },
      { id: 'batch-topic-2', agentId: agent2.id, userId },
    ]);
    await serverDB.insert(messages).values([
      {
        id: 'batch-msg-1',
        agentId: agent1.id,
        topicId: 'batch-topic-1',
        userId,
        role: 'assistant',
      },
      {
        id: 'batch-msg-2',
        agentId: agent2.id,
        topicId: 'batch-topic-2',
        userId,
        role: 'assistant',
      },
    ]);

    const results = await model.transferAgents([agent1.id, agent2.id], wsId1, userId);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.agentId)).toEqual([agent1.id, agent2.id]);

    for (const agentId of [agent1.id, agent2.id]) {
      const updated = await serverDB.query.agents.findFirst({ where: eq(agents.id, agentId) });
      expect(updated?.workspaceId).toBe(wsId1);
    }
    for (const topicId of ['batch-topic-1', 'batch-topic-2']) {
      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(topic.workspaceId).toBe(wsId1);
    }
    // Message rows stay untouched snapshots; visibility follows the topic.
    const wsMessages = new MessageModel(serverDB, userId, wsId1);
    for (const [msgId, topicId] of [
      ['batch-msg-1', 'batch-topic-1'],
      ['batch-msg-2', 'batch-topic-2'],
    ] as const) {
      const [msg] = await serverDB.select().from(messages).where(eq(messages.id, msgId));
      expect(msg.workspaceId).toBeNull();
      expect(await wsMessages.query({ topicId })).toHaveLength(1);
    }
  });

  it('should resolve slug conflicts against the target scope and within the batch', async () => {
    // Target workspace already holds `my-agent`
    const targetModel = new AgentModel(serverDB, userId, wsId2);
    await targetModel.create({ title: 'Existing', slug: 'my-agent' });

    const model = new AgentModel(serverDB, userId, wsId1);
    const agent1 = await model.create({ title: 'A1', slug: 'my-agent' });
    const agent2 = await model.create({ title: 'A2', slug: 'my-agent-1' });

    const results = await model.transferAgents([agent1.id, agent2.id], wsId2, userId);

    const slugs = new Map(results.map((r) => [r.agentId, r.slug]));
    // agent1 collides with the existing `my-agent` → suffixed; agent2 must not
    // end up colliding with whatever agent1 received.
    expect(slugs.get(agent1.id)).not.toBe('my-agent');
    expect(slugs.get(agent1.id)).not.toBe(slugs.get(agent2.id));

    const moved = await serverDB.query.agents.findMany({
      where: eq(agents.workspaceId, wsId2),
    });
    const movedSlugs = moved.map((a) => a.slug);
    expect(new Set(movedSlugs).size).toBe(movedSlugs.length);
  });

  it('should roll back the whole batch when any agent is missing', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Survivor' });

    await expect(model.transferAgents([agent.id, 'nonexistent'], wsId1, userId)).rejects.toThrow(
      'Agent not found',
    );

    const untouched = await serverDB.query.agents.findFirst({ where: eq(agents.id, agent.id) });
    expect(untouched?.workspaceId).toBeNull();
  });

  it('should reject the whole batch when a topic has a foreign comment', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent1 = await model.create({ title: 'Guarded 1' });
    const agent2 = await model.create({ title: 'Guarded 2' });
    await serverDB.insert(topics).values({
      agentId: agent2.id,
      id: 'batch-guard-topic',
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(topicComments).values({
      authorUserId: targetUserId,
      clientId: 'batch-guard-comment',
      content: 'teammate note',
      id: 'tcm-batch-guard',
      topicId: 'batch-guard-topic',
      workspaceId: wsId1,
    });

    await expect(
      model.transferAgents([agent1.id, agent2.id], wsId2, userId, undefined, {
        rejectForeignTopicCommentAuthors: true,
      }),
    ).rejects.toThrow(TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS);

    for (const agentId of [agent1.id, agent2.id]) {
      const untouched = await serverDB.query.agents.findFirst({ where: eq(agents.id, agentId) });
      expect(untouched?.workspaceId).toBe(wsId1);
    }
  });

  it('should return empty array for empty input', async () => {
    const model = new AgentModel(serverDB, userId);
    await expect(model.transferAgents([], wsId1, userId)).resolves.toEqual([]);
  });

  it('transferHasForeignRows should accept an array of agent ids', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const mine = await model.create({ title: 'Mine' });
    const foreign = await new AgentModel(serverDB, targetUserId, wsId1).create({
      title: 'Foreign',
      visibility: 'public',
    });

    await serverDB
      .insert(topics)
      .values({ id: 'foreign-topic', agentId: foreign.id, userId: targetUserId });

    await expect(model.transferHasForeignRows([mine.id])).resolves.toBe(false);
    await expect(model.transferHasForeignRows([mine.id, foreign.id])).resolves.toBe(true);
  });
});
