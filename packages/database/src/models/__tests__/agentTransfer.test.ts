// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentBotProviders,
  agents,
  agentsToSessions,
  briefs,
  chatGroups,
  chatGroupsAgents,
  documents,
  messages,
  sessions,
  taskComments,
  taskDependencies,
  taskDocuments,
  tasks,
  taskTopics,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

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
