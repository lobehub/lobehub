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

  it('is true for a teammate topic reached only through a linked session', async () => {
    await linkSession('agtg-own-session', ownerId);
    await serverDB.insert(topics).values({
      id: 'agtg-teammate-topic',
      sessionId: 'agtg-own-session',
      userId: teammateId,
      workspaceId: wsId,
    });

    expect(await ownerModel.transferHasForeignRows(agentId)).toBe(true);
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

  it('is true for a teammate message on a linked session', async () => {
    await linkSession('agtg-own-session', ownerId);
    await serverDB.insert(messages).values({
      id: 'agtg-teammate-message',
      role: 'user',
      sessionId: 'agtg-own-session',
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
