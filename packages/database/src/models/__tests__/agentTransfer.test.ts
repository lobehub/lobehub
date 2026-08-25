// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentBotProviders,
  agentCronJobs,
  agentDocuments,
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  agentsToSessions,
  briefs,
  chatGroups,
  chatGroupsAgents,
  documentHistories,
  documents,
  expertiseBindings,
  expertiseHits,
  expertiseInsights,
  expertiseRuns,
  files,
  knowledgeBases,
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
  topicDocuments,
  topics,
  userConnectors,
  userConnectorTools,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { ExpertiseModel } from '../expertise';
import {
  TOPIC_COMMENT_TOPIC_NOT_FOUND,
  TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS,
  TopicCommentModel,
} from '../topicComment';

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

  it('should transfer agent-owned expertise and its learned content', async () => {
    const agentModel = new AgentModel(serverDB, userId, wsId1);
    const agent = await agentModel.create({ title: 'Learning Agent' });
    const expertiseModel = new ExpertiseModel(serverDB, userId, wsId1);
    const domainId = await expertiseModel.createDomain({
      agentId: agent.id,
      brief: 'Improve incident response',
      domainFilter: 'I practice when I investigate production incidents.',
      title: 'Incident response',
    });
    const lesson = await expertiseModel.teachLesson({
      domainId,
      text: 'I verify the blast radius before changing production systems.',
    });
    const [run] = await serverDB
      .insert(expertiseRuns)
      .values({
        actorId: agent.id,
        actorType: 'agent',
        domainId,
        runIndex: 1,
        subjectId: 'incident-1',
        subjectType: 'topic',
        userId,
        workspaceId: wsId1,
      })
      .returning({ id: expertiseRuns.id });
    const [hit] = await serverDB
      .insert(expertiseHits)
      .values({
        domainId,
        lessonId: lesson!.id,
        outcome: 'pass',
        runId: run.id,
      })
      .returning({ id: expertiseHits.id });
    const [insight] = await serverDB
      .insert(expertiseInsights)
      .values({
        body: 'The same diagnostic gap appears repeatedly.',
        domainId,
        headline: 'Recurring diagnostic gap',
        kind: 'repeated-mistake',
        userId,
        workspaceId: wsId1,
      })
      .returning({ id: expertiseInsights.id });

    await agentModel.transferAgent(agent.id, wsId2, targetUserId);
    await serverDB.delete(workspaces).where(eq(workspaces.id, wsId1));

    const transferredExpertise = new ExpertiseModel(serverDB, targetUserId, wsId2);
    const [domain, lessons, binding, transferredInsight, transferredRun, transferredHit] =
      await Promise.all([
        transferredExpertise.findDomain(domainId),
        transferredExpertise.listLessons(domainId),
        serverDB
          .select({ workspaceId: expertiseBindings.workspaceId })
          .from(expertiseBindings)
          .where(eq(expertiseBindings.domainId, domainId)),
        serverDB
          .select({ workspaceId: expertiseInsights.workspaceId })
          .from(expertiseInsights)
          .where(eq(expertiseInsights.id, insight.id)),
        serverDB
          .select({ userId: expertiseRuns.userId, workspaceId: expertiseRuns.workspaceId })
          .from(expertiseRuns)
          .where(eq(expertiseRuns.id, run.id)),
        serverDB
          .select({ id: expertiseHits.id })
          .from(expertiseHits)
          .where(eq(expertiseHits.id, hit.id)),
      ]);

    expect(domain?.workspaceId).toBe(wsId2);
    expect(lessons).toHaveLength(1);
    expect(binding[0].workspaceId).toBe(wsId2);
    expect(transferredInsight[0].workspaceId).toBe(wsId2);
    expect(transferredRun[0]).toEqual({ userId: targetUserId, workspaceId: wsId2 });
    expect(transferredHit[0].id).toBe(hit.id);
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

  it('should update topics and messages', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Agent' });

    await serverDB.insert(topics).values({ id: 'topic-1', agentId: agent.id, userId });
    await serverDB
      .insert(messages)
      .values({ id: 'msg-1', agentId: agent.id, userId, role: 'assistant' });

    await model.transferAgent(agent.id, wsId1, userId);

    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, 'topic-1'));
    expect(topic.workspaceId).toBe(wsId1);

    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'msg-1'));
    expect(msg.workspaceId).toBe(wsId1);
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
    // Dedicated agent provenance + binding, so the document itself rides along
    // and its pin survives the move (a pin whose document stays behind is
    // detached instead — see the scope-riders suite).
    await serverDB.insert(documents).values({
      content: '',
      fileType: 'text/plain',
      id: 'task-doc',
      source: `agent-document://${agent.id}/task-doc.md`,
      sourceType: 'agent',
      title: 'Task doc',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'task-doc',
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
      source: `agent-document://${agent.id}/vis.md`,
      sourceType: 'agent',
      title: 'Doc',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'task-vis-doc',
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

  it('should refuse to move a group supervisor and leave the group untouched', async () => {
    // The regression this guards: the roster delete below used to run
    // unconditionally, so the group lost its supervisor, and the next read
    // silently minted a blank replacement — systemRole, model and all.
    const model = new AgentModel(serverDB, userId);
    const supervisor = await model.create({
      model: 'gpt-5',
      systemRole: 'You orchestrate the group',
      title: 'Supervisor',
      virtual: true,
    });

    await serverDB.insert(chatGroups).values({ id: 'sup-group', title: 'Squad', userId });
    await serverDB.insert(chatGroupsAgents).values({
      agentId: supervisor.id,
      chatGroupId: 'sup-group',
      role: 'supervisor',
      userId,
    });

    await expect(model.transferAgent(supervisor.id, wsId1, userId)).rejects.toMatchObject({
      groups: [{ agentId: supervisor.id, groupId: 'sup-group', groupTitle: 'Squad' }],
      message: 'AGENT_OWNED_BY_GROUP',
    });

    const [link] = await serverDB
      .select()
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.agentId, supervisor.id));
    expect(link.role).toBe('supervisor');

    const kept = await serverDB.query.agents.findFirst({ where: eq(agents.id, supervisor.id) });
    expect(kept).toMatchObject({
      model: 'gpt-5',
      systemRole: 'You orchestrate the group',
      workspaceId: null,
    });
  });

  it('should refuse a supervisor row regardless of the agent flags', async () => {
    const model = new AgentModel(serverDB, userId);
    const supervisor = await model.create({ title: 'Legacy Supervisor', virtual: true });

    await serverDB.insert(chatGroups).values({ id: 'legacy-sup-group', title: 'Legacy', userId });
    await serverDB.insert(chatGroupsAgents).values({
      agentId: supervisor.id,
      chatGroupId: 'legacy-sup-group',
      role: 'supervisor',
      userId,
    });

    await expect(model.transferAgent(supervisor.id, wsId1, userId)).rejects.toThrow(
      'AGENT_OWNED_BY_GROUP',
    );
  });

  it('getGroupMembershipImpact reports groups an agent would leave', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Joiner' });

    await serverDB.insert(chatGroups).values({ id: 'impact-group', title: 'Impact', userId });
    await serverDB.insert(chatGroupsAgents).values({
      agentId: agent.id,
      chatGroupId: 'impact-group',
      userId,
    });

    await expect(model.getGroupMembershipImpact([agent.id])).resolves.toEqual({
      blocked: [],
      leaving: [
        {
          agentId: agent.id,
          groupAvatar: null,
          groupBackgroundColor: null,
          groupId: 'impact-group',
          groupTitle: 'Impact',
          groupVisible: true,
        },
      ],
    });
  });

  it('getGroupMembershipImpact withholds the title of a group the caller cannot see', async () => {
    // The membership still counts — the guard must not weaken because of who
    // is asking — but the name of another member's private group is not the
    // caller's to read.
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'Shared', visibility: 'public' });

    await serverDB.insert(chatGroups).values({
      id: 'hidden-group',
      title: 'Someone Else Private Group',
      userId: targetUserId,
      visibility: 'private',
      workspaceId: wsId1,
    });
    await serverDB.insert(chatGroupsAgents).values({
      agentId: agent.id,
      chatGroupId: 'hidden-group',
      userId: targetUserId,
      workspaceId: wsId1,
    });

    await expect(model.getGroupMembershipImpact([agent.id])).resolves.toEqual({
      blocked: [],
      // A hidden group withholds its whole identity, not just the name.
      leaving: [
        {
          agentId: agent.id,
          groupAvatar: null,
          groupBackgroundColor: null,
          // Hidden as a unit: the id is identity too.
          groupId: null,
          groupTitle: null,
          groupVisible: false,
        },
      ],
    });
  });

  it('getGroupMembershipImpact reports nothing for an agent the caller cannot see', async () => {
    // Otherwise the endpoint answers "which groups is this id in?" for any id
    // at all. The guard inside `transferAgents` is deliberately unscoped; this
    // read is not, and the difference has to hold at the model boundary.
    const owner = new AgentModel(serverDB, targetUserId);
    const secret = await owner.create({ title: 'Not Yours' });

    await serverDB.insert(chatGroups).values({
      id: 'unseen-group',
      title: 'Unseen',
      userId: targetUserId,
    });
    await serverDB.insert(chatGroupsAgents).values({
      agentId: secret.id,
      chatGroupId: 'unseen-group',
      userId: targetUserId,
    });

    const stranger = new AgentModel(serverDB, userId);
    await expect(stranger.getGroupMembershipImpact([secret.id])).resolves.toEqual({
      blocked: [],
      leaving: [],
    });
  });

  it('should throw when agent not found', async () => {
    const model = new AgentModel(serverDB, userId);
    await expect(model.transferAgent('nonexistent', wsId1, userId)).rejects.toThrow(
      'Agent not found',
    );
  });
});

describe('AgentModel.transferAgent scope riders (connectors & documents)', () => {
  it('should move agent-scoped connectors with credentials when the owner stays the same', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Plugin Agent' });

    const [connector] = await serverDB
      .insert(userConnectors)
      .values({
        agentId: agent.id,
        credentials: 'encrypted-secret',
        identifier: 'my-custom-mcp',
        isEnabled: true,
        name: 'My Custom MCP',
        sourceType: 'custom',
        status: 'connected',
        userId,
      })
      .returning();
    await serverDB.insert(userConnectorTools).values({
      crudType: 'read',
      permission: 'auto',
      toolName: 'do_thing',
      userConnectorId: connector.id,
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId);

    const [moved] = await serverDB
      .select()
      .from(userConnectors)
      .where(eq(userConnectors.id, connector.id));
    expect(moved.workspaceId).toBe(wsId1);
    expect(moved.userId).toBe(userId);
    // Same owner: credentials ride along, the plugin keeps working.
    expect(moved.credentials).toBe('encrypted-secret');
    expect(moved.status).toBe('connected');

    const [tool] = await serverDB
      .select()
      .from(userConnectorTools)
      .where(eq(userConnectorTools.userConnectorId, connector.id));
    expect(tool.workspaceId).toBe(wsId1);
    expect(tool.userId).toBe(userId);
  });

  it('should strip credentials from foreign-owned agent connectors on scope transfer', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'Shared Agent' });

    // Another member connected this agent-scoped connector with THEIR account.
    const [connector] = await serverDB
      .insert(userConnectors)
      .values({
        agentId: agent.id,
        credentials: 'their-secret',
        identifier: 'their-mcp',
        isEnabled: true,
        name: 'Their MCP',
        sourceType: 'custom',
        status: 'connected',
        userId: targetUserId,
        workspaceId: wsId1,
      })
      .returning();

    await model.transferAgent(agent.id, null, userId);

    const [moved] = await serverDB
      .select()
      .from(userConnectors)
      .where(eq(userConnectors.id, connector.id));
    expect(moved.workspaceId).toBeNull();
    expect(moved.userId).toBe(userId);
    // Ownership changed: the previous owner's credentials never travel.
    expect(moved.credentials).toBeNull();
    expect(moved.status).toBe('disconnected');
    expect(moved.isEnabled).toBe(false);
  });

  it('should unmount base connectors linked by the moved agent', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Mount Agent' });

    const [base] = await serverDB
      .insert(userConnectors)
      .values({
        identifier: 'personal-linear',
        isEnabled: true,
        metadata: { mountedByAgentId: agent.id },
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
        userId,
      })
      .returning();

    await model.transferAgent(agent.id, wsId1, userId);

    const [after] = await serverDB
      .select()
      .from(userConnectors)
      .where(eq(userConnectors.id, base.id));
    // The base row stays in the source scope, just unmounted.
    expect(after.workspaceId).toBeNull();
    expect(after.metadata?.mountedByAgentId).toBeUndefined();
  });

  it('should move dedicated agent documents with binding and history', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Doc Agent' });

    await serverDB.insert(documents).values({
      content: '# skill',
      fileType: 'text/markdown',
      id: 'dedicated-doc',
      source: `agent-document://${agent.id}/skill.md`,
      sourceType: 'agent',
      title: 'skill.md',
      totalCharCount: 7,
      totalLineCount: 1,
      userId,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'dedicated-doc',
      userId,
    });
    await serverDB.insert(documentHistories).values({
      documentId: 'dedicated-doc',
      editorData: {},
      saveSource: 'manual',
      savedAt: new Date(),
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId, 'private');

    const [doc] = await serverDB.select().from(documents).where(eq(documents.id, 'dedicated-doc'));
    expect(doc.workspaceId).toBe(wsId1);
    expect(doc.userId).toBe(userId);
    expect(doc.visibility).toBe('private');

    const [binding] = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.agentId, agent.id));
    expect(binding.workspaceId).toBe(wsId1);
    expect(binding.userId).toBe(userId);

    const [history] = await serverDB
      .select()
      .from(documentHistories)
      .where(eq(documentHistories.documentId, 'dedicated-doc'));
    expect(history.workspaceId).toBe(wsId1);
  });

  it('should detach associated documents and leave them in the source scope', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Assoc Agent' });

    await serverDB.insert(documents).values({
      content: 'notes',
      fileType: 'text/plain',
      id: 'assoc-doc',
      source: 'https://example.com/notes',
      sourceType: 'web',
      title: 'Personal notes',
      totalCharCount: 5,
      totalLineCount: 1,
      userId,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'assoc-doc',
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId);

    const [doc] = await serverDB.select().from(documents).where(eq(documents.id, 'assoc-doc'));
    // The pre-existing personal document is NOT the agent's property.
    expect(doc.workspaceId).toBeNull();
    expect(doc.userId).toBe(userId);

    const bindings = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.agentId, agent.id));
    expect(bindings).toHaveLength(0);
  });

  it('should keep a dedicated document bound to an outside agent in the source scope', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Moving Agent' });
    const stayingAgent = await model.create({ title: 'Staying Agent' });

    await serverDB.insert(documents).values({
      content: 'shared skill',
      fileType: 'text/markdown',
      id: 'shared-dedicated-doc',
      source: `agent-document://${agent.id}/shared.md`,
      sourceType: 'agent',
      title: 'shared.md',
      totalCharCount: 12,
      totalLineCount: 1,
      userId,
    });
    await serverDB.insert(agentDocuments).values([
      { agentId: agent.id, documentId: 'shared-dedicated-doc', userId },
      { agentId: stayingAgent.id, documentId: 'shared-dedicated-doc', userId },
    ]);

    await model.transferAgent(agent.id, wsId1, userId);

    const [doc] = await serverDB
      .select()
      .from(documents)
      .where(eq(documents.id, 'shared-dedicated-doc'));
    // An external consumer pins the document to the source scope.
    expect(doc.workspaceId).toBeNull();

    const movedBindings = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.agentId, agent.id));
    expect(movedBindings).toHaveLength(0);

    const stayingBindings = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.agentId, stayingAgent.id));
    expect(stayingBindings).toHaveLength(1);
    expect(stayingBindings[0].workspaceId).toBeNull();
  });

  it('should move a dedicated document referenced only by topics that move too', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Topic Doc Agent' });

    await serverDB
      .insert(topics)
      .values({ agentId: agent.id, id: 'moving-topic', title: 'T', userId });
    await serverDB.insert(documents).values({
      content: 'report',
      fileType: 'text/markdown',
      id: 'topic-ref-doc',
      source: `agent-document://${agent.id}/report.md`,
      sourceType: 'agent',
      title: 'report.md',
      totalCharCount: 6,
      totalLineCount: 1,
      userId,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'topic-ref-doc',
      userId,
    });
    await serverDB.insert(topicDocuments).values({
      documentId: 'topic-ref-doc',
      topicId: 'moving-topic',
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId);

    // The referencing topic moves with the agent, so the document moves too —
    // and the topic-document link follows its topic's scope.
    const [doc] = await serverDB.select().from(documents).where(eq(documents.id, 'topic-ref-doc'));
    expect(doc.workspaceId).toBe(wsId1);

    const [link] = await serverDB
      .select()
      .from(topicDocuments)
      .where(eq(topicDocuments.topicId, 'moving-topic'));
    expect(link.workspaceId).toBe(wsId1);
    expect(link.userId).toBe(userId);
  });

  it('should detach a moved topic link whose document stays in the source scope', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Assoc Topic Agent' });

    await serverDB
      .insert(topics)
      .values({ agentId: agent.id, id: 'assoc-link-topic', title: 'T', userId });
    // Not agent provenance: an ordinary personal document the user attached to
    // the conversation, so it stays behind when the agent moves.
    await serverDB.insert(documents).values({
      content: 'notes',
      fileType: 'text/plain',
      id: 'stays-doc',
      source: 'https://example.com/notes',
      sourceType: 'web',
      title: 'Personal notes',
      totalCharCount: 5,
      totalLineCount: 1,
      userId,
    });
    await serverDB.insert(topicDocuments).values({
      documentId: 'stays-doc',
      topicId: 'assoc-link-topic',
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId);

    const [doc] = await serverDB.select().from(documents).where(eq(documents.id, 'stays-doc'));
    expect(doc.workspaceId).toBeNull();

    // A link carried into the target would resolve in neither scope: the read
    // path joins the junction AND the document against the same predicate.
    const links = await serverDB
      .select()
      .from(topicDocuments)
      .where(eq(topicDocuments.topicId, 'assoc-link-topic'));
    expect(links).toHaveLength(0);
  });

  it('should detach a moved task pin whose document stays in the source scope', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Assoc Task Agent' });

    await serverDB.insert(tasks).values({
      createdByAgentId: agent.id,
      createdByUserId: userId,
      id: 'assoc-link-task',
      identifier: 'T-assoc',
      instruction: 'Do the thing',
      seq: 1,
    });
    await serverDB.insert(documents).values({
      content: 'notes',
      fileType: 'text/plain',
      id: 'task-stays-doc',
      source: 'https://example.com/notes',
      sourceType: 'web',
      title: 'Personal notes',
      totalCharCount: 5,
      totalLineCount: 1,
      userId,
    });
    await serverDB.insert(taskDocuments).values({
      documentId: 'task-stays-doc',
      taskId: 'assoc-link-task',
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId);

    const [doc] = await serverDB.select().from(documents).where(eq(documents.id, 'task-stays-doc'));
    expect(doc.workspaceId).toBeNull();

    const pins = await serverDB
      .select()
      .from(taskDocuments)
      .where(eq(taskDocuments.taskId, 'assoc-link-task'));
    expect(pins).toHaveLength(0);
  });

  it('should leave a document whose provenance names an agent outside the move', async () => {
    const model = new AgentModel(serverDB, userId);
    const outsider = await model.create({ title: 'Outsider Agent' });
    const agent = await model.create({ title: 'Borrower Agent' });

    // Created for `outsider`, later associated to the moving agent. Provenance
    // alone would read as "dedicated" and hand it over with the move.
    await serverDB.insert(documents).values({
      content: '# skill',
      fileType: 'text/markdown',
      id: 'foreign-provenance-doc',
      source: `agent-document://${outsider.id}/skill.md`,
      sourceType: 'agent',
      title: 'skill.md',
      totalCharCount: 7,
      totalLineCount: 1,
      userId,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'foreign-provenance-doc',
      userId,
    });
    // The originating agent is gone, so no external binding holds it back.
    await serverDB.delete(agents).where(eq(agents.id, outsider.id));

    await model.transferAgent(agent.id, wsId1, userId);

    const [doc] = await serverDB
      .select()
      .from(documents)
      .where(eq(documents.id, 'foreign-provenance-doc'));
    expect(doc.workspaceId).toBeNull();
    expect(doc.userId).toBe(userId);

    // Associated policy: the binding is detached, the document stays put.
    const bindings = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.agentId, agent.id));
    expect(bindings).toHaveLength(0);
  });

  it("should leave another member's skill bundle that was only associated", async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Skill Borrower' });

    // Skill-management provenance carries no agent id; only the create/convert
    // flows stamp the binding, and `associate` does not.
    await serverDB.insert(documents).values({
      content: '',
      fileType: 'skills/bundle',
      id: 'borrowed-skill-doc',
      source: 'agent-signal:skill-management',
      sourceType: 'agent-signal',
      title: 'Borrowed skill',
      totalCharCount: 0,
      totalLineCount: 0,
      userId: targetUserId,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'borrowed-skill-doc',
      templateId: null,
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId);

    const [doc] = await serverDB
      .select()
      .from(documents)
      .where(eq(documents.id, 'borrowed-skill-doc'));
    expect(doc.workspaceId).toBeNull();
    expect(doc.userId).toBe(targetUserId);

    const bindings = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.agentId, agent.id));
    expect(bindings).toHaveLength(0);
  });

  it("should move an agent's own skill bundle together with its index", async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Skill Owner' });

    await serverDB.insert(documents).values([
      {
        content: '',
        fileType: 'skills/bundle',
        id: 'own-skill-bundle',
        source: 'agent-signal:skill-management',
        sourceType: 'agent-signal',
        title: 'Own skill',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
      },
      {
        content: '# skill',
        fileType: 'skills/index',
        id: 'own-skill-index',
        parentId: 'own-skill-bundle',
        source: 'agent-signal:skill-management',
        sourceType: 'agent-signal',
        title: 'SKILL.md',
        totalCharCount: 7,
        totalLineCount: 1,
        userId,
      },
    ]);
    await serverDB.insert(agentDocuments).values([
      { agentId: agent.id, documentId: 'own-skill-bundle', templateId: 'agent-skill', userId },
      { agentId: agent.id, documentId: 'own-skill-index', templateId: 'agent-skill', userId },
    ]);

    await model.transferAgent(agent.id, wsId1, userId);

    const docs = await serverDB
      .select()
      .from(documents)
      .where(inArray(documents.id, ['own-skill-bundle', 'own-skill-index']));
    expect(docs).toHaveLength(2);
    for (const doc of docs) expect(doc.workspaceId).toBe(wsId1);
  });

  it('should hold a whole skill tree back when one node is pinned outside the move', async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Pinned Skill Owner' });

    // A task that is NOT moving with this transfer pins the index alone.
    await serverDB.insert(tasks).values({
      createdByUserId: userId,
      id: 'outside-task',
      identifier: 'T-outside',
      instruction: 'Unrelated',
      seq: 1,
    });
    await serverDB.insert(documents).values([
      {
        content: '',
        fileType: 'skills/bundle',
        id: 'pinned-skill-bundle',
        source: 'agent-signal:skill-management',
        sourceType: 'agent-signal',
        title: 'Pinned skill',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
      },
      {
        content: '# skill',
        fileType: 'skills/index',
        id: 'pinned-skill-index',
        parentId: 'pinned-skill-bundle',
        source: 'agent-signal:skill-management',
        sourceType: 'agent-signal',
        title: 'SKILL.md',
        totalCharCount: 7,
        totalLineCount: 1,
        userId,
      },
    ]);
    await serverDB.insert(agentDocuments).values([
      { agentId: agent.id, documentId: 'pinned-skill-bundle', templateId: 'agent-skill', userId },
      { agentId: agent.id, documentId: 'pinned-skill-index', templateId: 'agent-skill', userId },
    ]);
    await serverDB
      .insert(taskDocuments)
      .values({ documentId: 'pinned-skill-index', taskId: 'outside-task', userId });

    await model.transferAgent(agent.id, wsId1, userId);

    // `parent_id` is never rewritten, so moving the bundle without its pinned
    // index would leave a tree straddling two scopes.
    const docs = await serverDB
      .select()
      .from(documents)
      .where(inArray(documents.id, ['pinned-skill-bundle', 'pinned-skill-index']));
    expect(docs).toHaveLength(2);
    for (const doc of docs) expect(doc.workspaceId).toBeNull();
  });

  it("should drop the slug when it collides with another member's private document", async () => {
    const model = new AgentModel(serverDB, userId);
    const agent = await model.create({ title: 'Slug Agent' });

    // Invisible to the mover through the read predicate, but the
    // `documents_slug_workspace_id_unique` index still covers it.
    await serverDB.insert(documents).values({
      content: 'private',
      fileType: 'text/markdown',
      id: 'target-private-doc',
      slug: 'shared-slug',
      source: 'https://example.com/private',
      sourceType: 'web',
      title: 'Private',
      totalCharCount: 7,
      totalLineCount: 1,
      userId: targetUserId,
      visibility: 'private',
      workspaceId: wsId1,
    });
    await serverDB.insert(documents).values({
      content: '# skill',
      fileType: 'text/markdown',
      id: 'slug-doc',
      slug: 'shared-slug',
      source: `agent-document://${agent.id}/skill.md`,
      sourceType: 'agent',
      title: 'skill.md',
      totalCharCount: 7,
      totalLineCount: 1,
      userId,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'slug-doc',
      userId,
    });

    await model.transferAgent(agent.id, wsId1, userId);

    const [doc] = await serverDB.select().from(documents).where(eq(documents.id, 'slug-doc'));
    expect(doc.workspaceId).toBe(wsId1);
    expect(doc.slug).toBeNull();
  });

  it('should rehome revision history to the new owner when moving to personal scope', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'History Agent' });

    await serverDB.insert(documents).values({
      content: '# skill',
      fileType: 'text/markdown',
      id: 'history-doc',
      source: `agent-document://${agent.id}/skill.md`,
      sourceType: 'agent',
      title: 'skill.md',
      totalCharCount: 7,
      totalLineCount: 1,
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'history-doc',
      userId,
      workspaceId: wsId1,
    });
    // Authored by the member who is NOT the transfer target.
    await serverDB.insert(documentHistories).values({
      documentId: 'history-doc',
      editorData: {},
      saveSource: 'manual',
      savedAt: new Date(),
      userId,
      workspaceId: wsId1,
    });

    await model.transferAgent(agent.id, null, targetUserId);

    const [history] = await serverDB
      .select()
      .from(documentHistories)
      .where(eq(documentHistories.documentId, 'history-doc'));
    // Personal reads are `user_id = owner AND workspace_id IS NULL`; keeping
    // the author here would hide the history from its new owner and let it
    // cascade away with the author's account.
    expect(history.workspaceId).toBeNull();
    expect(history.userId).toBe(targetUserId);
  });

  it('should keep revision authorship when the document lands in a workspace', async () => {
    const model = new AgentModel(serverDB, userId, wsId1);
    const agent = await model.create({ title: 'History WS Agent' });

    await serverDB.insert(documents).values({
      content: '# skill',
      fileType: 'text/markdown',
      id: 'history-ws-doc',
      source: `agent-document://${agent.id}/skill.md`,
      sourceType: 'agent',
      title: 'skill.md',
      totalCharCount: 7,
      totalLineCount: 1,
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(agentDocuments).values({
      agentId: agent.id,
      documentId: 'history-ws-doc',
      userId,
      workspaceId: wsId1,
    });
    await serverDB.insert(documentHistories).values({
      documentId: 'history-ws-doc',
      editorData: {},
      saveSource: 'manual',
      savedAt: new Date(),
      userId,
      workspaceId: wsId1,
    });

    await model.transferAgent(agent.id, wsId2, targetUserId);

    const [history] = await serverDB
      .select()
      .from(documentHistories)
      .where(eq(documentHistories.documentId, 'history-ws-doc'));
    // A workspace target filters on `workspace_id` alone, so the revision keeps
    // pointing at whoever actually wrote it.
    expect(history.workspaceId).toBe(wsId2);
    expect(history.userId).toBe(userId);
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
      { id: 'batch-msg-1', agentId: agent1.id, userId, role: 'assistant' },
      { id: 'batch-msg-2', agentId: agent2.id, userId, role: 'assistant' },
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
    for (const msgId of ['batch-msg-1', 'batch-msg-2']) {
      const [msg] = await serverDB.select().from(messages).where(eq(messages.id, msgId));
      expect(msg.workspaceId).toBe(wsId1);
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
