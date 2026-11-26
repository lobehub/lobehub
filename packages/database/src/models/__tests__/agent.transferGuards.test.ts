// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentHistoryJobs,
  agents,
  agentsToSessions,
  messages,
  sessions,
  tasks,
  threads,
  topicComments,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AGENT_OWNERSHIP_STALE, AgentModel } from '../agent';
import { AGENT_COPY_IN_PROGRESS } from '../agentCopyJob';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'agtg-owner';
const teammateId = 'agtg-teammate';
const recipientId = 'agtg-recipient';
const wsId = 'agtg-ws';
const agentId = 'agtg-agent';
const copyJobId = 'agtg-copy-job';

const ownerModel = new AgentModel(serverDB, ownerId, wsId);

const cleanup = async () => {
  // History jobs carry no FK onto users, so they would outlive the cascade.
  await serverDB.delete(agentHistoryJobs).where(eq(agentHistoryJobs.id, copyJobId));
  await serverDB.delete(users).where(inArray(users.id, [ownerId, teammateId, recipientId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: ownerId }, { id: teammateId }, { id: recipientId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: wsId, name: 'agtg ws', primaryOwnerId: ownerId, slug: 'agtg-ws' });
  await serverDB.insert(agents).values({ id: agentId, userId: ownerId, workspaceId: wsId });
});

afterEach(async () => {
  await cleanup();
});

/** A session linked to the agent, created by `userId`. */
const linkSession = async (sessionId: string, userId: string) => {
  await serverDB.insert(sessions).values({ id: sessionId, userId, workspaceId: wsId });
  await serverDB.insert(agentsToSessions).values({ agentId, sessionId, userId, workspaceId: wsId });
};

describe('AgentModel.transferHasForeignRows', () => {
  it('is false for an empty agent list without touching the database', async () => {
    expect(await ownerModel.transferHasForeignRows([])).toBe(false);
  });

  it('is false when every cascaded row belongs to the caller', async () => {
    await linkSession('agtg-own-session', ownerId);
    await serverDB.insert(topics).values([
      { id: 'agtg-own-topic', sessionId: 'agtg-own-session', userId: ownerId, workspaceId: wsId },
      { agentId, id: 'agtg-own-agent-topic', userId: ownerId, workspaceId: wsId },
    ]);
    await serverDB.insert(messages).values({
      agentId,
      id: 'agtg-own-message',
      role: 'user',
      sessionId: 'agtg-own-session',
      userId: ownerId,
    });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(false);
  });

  it('is true when a teammate owns a session linked to the agent', async () => {
    await linkSession('agtg-own-session', ownerId);
    await linkSession('agtg-teammate-session', teammateId);

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(true);
  });

  it('ignores a teammate topic carrying only a legacy session id, which stays behind', async () => {
    await linkSession('agtg-own-session', ownerId);
    await serverDB.insert(topics).values({
      id: 'agtg-teammate-topic',
      sessionId: 'agtg-own-session',
      userId: teammateId,
      workspaceId: wsId,
    });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(false);
  });

  it('is true for a teammate topic on an agent with no linked session', async () => {
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-teammate-topic', userId: teammateId, workspaceId: wsId });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(true);
  });

  it("is true for a teammate's comment on the caller's own topic", async () => {
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId });
    await serverDB.insert(topicComments).values({
      authorUserId: teammateId,
      clientId: 'agtg-comment-client',
      content: 'teammate note',
      topicId: 'agtg-own-topic',
      workspaceId: wsId,
    });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(true);
  });

  it('ignores a teammate message carrying only a legacy session id, which stays behind', async () => {
    await linkSession('agtg-own-session', ownerId);
    await serverDB.insert(messages).values({
      id: 'agtg-teammate-message',
      role: 'user',
      sessionId: 'agtg-own-session',
      userId: teammateId,
    });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(false);
  });

  it("is true for a teammate message without an agent id inside the agent's topic", async () => {
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId });
    await serverDB.insert(messages).values({
      id: 'agtg-teammate-message',
      role: 'user',
      topicId: 'agtg-own-topic',
      userId: teammateId,
    });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(true);
  });

  it('is true for a teammate message on an agent with no linked session', async () => {
    await serverDB
      .insert(messages)
      .values({ agentId, id: 'agtg-teammate-message', role: 'user', userId: teammateId });

    expect(await ownerModel.transferHasForeignRows([agentId])).toBe(true);
  });

  it('is true for a teammate thread on the agent', async () => {
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId });
    await serverDB.insert(threads).values({
      agentId,
      id: 'agtg-teammate-thread',
      topicId: 'agtg-own-topic',
      type: 'standalone',
      userId: teammateId,
    });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(true);
  });

  it('is true for a task a teammate assigned to the agent', async () => {
    await serverDB.insert(tasks).values({
      assigneeAgentId: agentId,
      createdByUserId: teammateId,
      identifier: 'AGTG-1',
      instruction: 'teammate task',
      seq: 1,
      workspaceId: wsId,
    });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(true);
  });
});

describe('AgentModel.getDeleteImpact', () => {
  it('reports nothing foreign when every cascaded row belongs to the caller', async () => {
    await linkSession('agtg-own-session', ownerId);
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: false,
    });
  });

  it("counts teammates' live topics on the agent, not ones carrying only a session id", async () => {
    await linkSession('agtg-teammate-session', teammateId);
    await serverDB.insert(topics).values([
      { agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId },
      { agentId, id: 'agtg-teammate-topic', userId: teammateId, workspaceId: wsId },
      {
        id: 'agtg-teammate-session-topic',
        sessionId: 'agtg-teammate-session',
        userId: teammateId,
        workspaceId: wsId,
      },
      {
        agentId,
        id: 'agtg-teammate-trashed-topic',
        isDeleted: true,
        userId: teammateId,
        workspaceId: wsId,
      },
    ]);

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 1,
      hasForeignContent: true,
    });
  });

  it("flags a teammate's comment on the caller's own topic without counting a topic", async () => {
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId });
    await serverDB.insert(topicComments).values({
      authorUserId: teammateId,
      clientId: 'agtg-comment-client',
      content: 'teammate note',
      topicId: 'agtg-own-topic',
      workspaceId: wsId,
    });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: true,
    });
  });

  it("ignores a teammate's empty session, thread and task, which the trash cascade leaves in place", async () => {
    await linkSession('agtg-teammate-session', teammateId);
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId });
    await serverDB.insert(threads).values({
      agentId,
      id: 'agtg-teammate-thread',
      topicId: 'agtg-own-topic',
      type: 'standalone',
      userId: teammateId,
    });
    await serverDB.insert(tasks).values({
      assigneeAgentId: agentId,
      createdByUserId: teammateId,
      identifier: 'AGTG-1',
      instruction: 'teammate task',
      seq: 1,
      workspaceId: wsId,
    });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: false,
    });
  });

  it("flags a teammate's topicless message on the agent, which the cascade trashes", async () => {
    await serverDB
      .insert(messages)
      .values({ agentId, id: 'agtg-teammate-message', role: 'user', userId: teammateId });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: true,
    });
  });

  it("ignores a teammate's message inside a topic that is already in the trash", async () => {
    await serverDB.insert(topics).values({
      agentId,
      id: 'agtg-teammate-trashed-topic',
      isDeleted: true,
      userId: teammateId,
      workspaceId: wsId,
    });
    await serverDB.insert(messages).values({
      agentId,
      id: 'agtg-teammate-message',
      role: 'user',
      topicId: 'agtg-teammate-trashed-topic',
      userId: teammateId,
    });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: false,
    });
  });

  it("flags a teammate's message inside the caller's live topic", async () => {
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId });
    await serverDB.insert(messages).values({
      agentId,
      id: 'agtg-teammate-message',
      role: 'user',
      topicId: 'agtg-own-topic',
      userId: teammateId,
    });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: true,
    });
  });

  it("flags a teammate's message in the caller's live topic even without the agent or session on the message", async () => {
    await serverDB
      .insert(topics)
      .values({ agentId, id: 'agtg-own-topic', userId: ownerId, workspaceId: wsId });
    await serverDB.insert(messages).values({
      id: 'agtg-teammate-message',
      role: 'user',
      topicId: 'agtg-own-topic',
      userId: teammateId,
    });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: true,
    });
  });

  it("ignores a teammate's message tagged with the agent but kept in a topic outside the cascade", async () => {
    await serverDB
      .insert(topics)
      .values({ id: 'agtg-unrelated-topic', userId: ownerId, workspaceId: wsId });
    await serverDB.insert(messages).values({
      agentId,
      id: 'agtg-teammate-message',
      role: 'user',
      topicId: 'agtg-unrelated-topic',
      userId: teammateId,
    });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: false,
    });
  });

  it("ignores a teammate's topicless message carrying only a legacy session id", async () => {
    await linkSession('agtg-own-session', ownerId);
    await serverDB.insert(messages).values({
      id: 'agtg-teammate-message',
      role: 'user',
      sessionId: 'agtg-own-session',
      userId: teammateId,
    });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: false,
    });
  });

  it("ignores a teammate's message that is already in the trash", async () => {
    await serverDB.insert(messages).values({
      agentId,
      id: 'agtg-teammate-message',
      isDeleted: true,
      role: 'user',
      userId: teammateId,
    });

    expect(await ownerModel.getDeleteImpact(agentId)).toEqual({
      foreignTopicCount: 0,
      hasForeignContent: false,
    });
  });
});

describe('AgentModel.transferAgent with legacy session-only rows', () => {
  const targetWs = 'agtg-target-ws';

  beforeEach(async () => {
    await serverDB
      .insert(workspaces)
      .values({ id: targetWs, name: 'target', primaryOwnerId: ownerId, slug: targetWs });
  });

  it('leaves them and their shell in the source scope and drops the link', async () => {
    await linkSession('agtg-legacy-session', ownerId);
    await serverDB.insert(topics).values([
      { agentId, id: 'agtg-moved-topic', userId: ownerId, workspaceId: wsId },
      {
        id: 'agtg-legacy-topic',
        sessionId: 'agtg-legacy-session',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);

    await ownerModel.transferAgent(agentId, targetWs, ownerId, 'public');

    const scopeOf = async (id: string) =>
      (await serverDB.select().from(topics).where(eq(topics.id, id)))[0]?.workspaceId;
    expect(await scopeOf('agtg-moved-topic')).toBe(targetWs);
    expect(await scopeOf('agtg-legacy-topic')).toBe(wsId);
    const [shell] = await serverDB
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'agtg-legacy-session'));
    expect(shell.workspaceId).toBe(wsId);
    expect(
      await serverDB.select().from(agentsToSessions).where(eq(agentsToSessions.agentId, agentId)),
    ).toEqual([]);
  });

  it('keeps a held topic whole, and a later delete of the moved agent does not empty it', async () => {
    await linkSession('agtg-legacy-session', ownerId);
    await serverDB.insert(topics).values({
      id: 'agtg-legacy-topic',
      sessionId: 'agtg-legacy-session',
      userId: ownerId,
      workspaceId: wsId,
    });
    await serverDB.insert(messages).values({
      agentId,
      id: 'agtg-tagged-message',
      role: 'user',
      topicId: 'agtg-legacy-topic',
      userId: ownerId,
      workspaceId: wsId,
    });
    await serverDB.insert(threads).values({
      agentId,
      id: 'agtg-tagged-thread',
      topicId: 'agtg-legacy-topic',
      type: 'standalone',
      userId: ownerId,
      workspaceId: wsId,
    });

    await ownerModel.transferAgent(agentId, targetWs, ownerId, 'public');

    const threadRow = async () =>
      (await serverDB.select().from(threads).where(eq(threads.id, 'agtg-tagged-thread')))[0];
    const messageRow = async () =>
      (await serverDB.select().from(messages).where(eq(messages.id, 'agtg-tagged-message')))[0];
    expect((await threadRow()).workspaceId).toBe(wsId);
    expect((await messageRow()).workspaceId).toBe(wsId);

    await new AgentModel(serverDB, ownerId, targetWs).delete(agentId);

    expect(await serverDB.select().from(agents).where(eq(agents.id, agentId))).toEqual([]);
    expect((await threadRow()).agentId).toBeNull();
    expect((await messageRow()).agentId).toBeNull();
  });

  it('moved rows drop a held shell, so deleting the source session cannot cascade into them', async () => {
    await linkSession('agtg-shared-session', ownerId);
    await serverDB.insert(topics).values([
      {
        id: 'agtg-stays-topic',
        sessionId: 'agtg-shared-session',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId,
        id: 'agtg-moves-topic',
        sessionId: 'agtg-shared-session',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(messages).values([
      {
        agentId,
        id: 'agtg-moves-in-topic',
        role: 'user',
        sessionId: 'agtg-shared-session',
        topicId: 'agtg-moves-topic',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId,
        id: 'agtg-moves-topicless',
        role: 'user',
        sessionId: 'agtg-shared-session',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);

    await ownerModel.transferAgent(agentId, targetWs, ownerId, 'public');
    await serverDB.delete(sessions).where(eq(sessions.id, 'agtg-shared-session'));

    const [movedTopic] = await serverDB
      .select()
      .from(topics)
      .where(eq(topics.id, 'agtg-moves-topic'));
    expect(movedTopic).toMatchObject({ sessionId: null, workspaceId: targetWs });
    const moved = await serverDB
      .select()
      .from(messages)
      .where(inArray(messages.id, ['agtg-moves-in-topic', 'agtg-moves-topicless']));
    expect(moved).toHaveLength(2);
    expect(moved.every((row) => row.sessionId === null && row.workspaceId === targetWs)).toBe(true);
    // The row that stayed went with its own session, as any session delete does.
    expect(await serverDB.select().from(topics).where(eq(topics.id, 'agtg-stays-topic'))).toEqual(
      [],
    );
  });

  it('still moves a linked shell that holds nothing outside the agent', async () => {
    await linkSession('agtg-clean-session', ownerId);
    await serverDB.insert(topics).values({
      agentId,
      id: 'agtg-clean-topic',
      sessionId: 'agtg-clean-session',
      userId: ownerId,
      workspaceId: wsId,
    });

    await ownerModel.transferAgent(agentId, targetWs, ownerId, 'public');

    const [shell] = await serverDB
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'agtg-clean-session'));
    expect(shell.workspaceId).toBe(targetWs);
    const [link] = await serverDB
      .select()
      .from(agentsToSessions)
      .where(eq(agentsToSessions.agentId, agentId));
    expect(link.workspaceId).toBe(targetWs);
  });
});

describe('AgentModel.transferAgentOwnership guards', () => {
  const handover = (model: AgentModel) =>
    serverDB.transaction((trx) =>
      model.transferAgentOwnership(trx, { agentId, fromUserId: ownerId, toUserId: recipientId }),
    );

  const ownerOf = async () => {
    const [row] = await serverDB
      .select({ userId: agents.userId })
      .from(agents)
      .where(eq(agents.id, agentId));
    return row?.userId;
  };

  it('treats a handover outside a workspace as stale and leaves the agent alone', async () => {
    await expect(handover(new AgentModel(serverDB, recipientId))).rejects.toThrow(
      AGENT_OWNERSHIP_STALE,
    );
    expect(await ownerOf()).toBe(ownerId);
  });

  it('refuses while a pending copy job still reads from the agent', async () => {
    await serverDB.insert(agentHistoryJobs).values({
      agentIds: ['agtg-copy-target'],
      id: copyJobId,
      payload: { agents: [{ newAgentId: 'agtg-copy-target', sourceAgentId: agentId }] },
      sessionIds: [],
      sourceUserId: ownerId,
      sourceWorkspaceId: wsId,
      status: 'pending',
      targetUserId: ownerId,
      targetWorkspaceId: wsId,
      totalTopics: 0,
      type: 'copy',
    });

    await expect(handover(new AgentModel(serverDB, recipientId, wsId))).rejects.toThrow(
      AGENT_COPY_IN_PROGRESS,
    );
    expect(await ownerOf()).toBe(ownerId);
  });
});
