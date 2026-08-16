// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, messages, threads, topics, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AGENT_OWNERSHIP_STALE, AgentModel } from '../agent';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../agentTransferJob';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'handover-owner';
const recipientId = 'handover-recipient';
const teammateId = 'handover-teammate';
const wsId = 'handover-ws';

const ownerModel = new AgentModel(serverDB, ownerId, wsId);
const recipientModel = new AgentModel(serverDB, recipientId, wsId);

const handover = (params: Parameters<AgentModel['transferAgentOwnership']>[1]) =>
  serverDB.transaction(async (trx) => recipientModel.transferAgentOwnership(trx, params));

beforeEach(async () => {
  delete process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD;
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: recipientId }, { id: teammateId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: wsId, name: 'Handover WS', primaryOwnerId: ownerId, slug: 'handover-ws' }]);
});

afterEach(async () => {
  delete process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD;
  await serverDB.delete(users);
});

describe('AgentModel.transferAgentOwnership', () => {
  it('flips only the agent owner; scope, slug and visibility stay put', async () => {
    const agent = await ownerModel.create({
      slug: 'handover-agent',
      title: 'Handover Agent',
      visibility: 'public',
    });

    const result = await handover({
      agentId: agent.id,
      fromUserId: ownerId,
      toUserId: recipientId,
    });
    expect(result.transferJobId).toBeNull();

    const [updated] = await serverDB.select().from(agents).where(eq(agents.id, agent.id));
    expect(updated.userId).toBe(recipientId);
    expect(updated.workspaceId).toBe(wsId);
    expect(updated.slug).toBe('handover-agent');
    expect(updated.visibility).toBe('public');
  });

  it('keeps everyone’s conversations without migrateSessions', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(topics).values([
      { agentId: agent.id, id: 'owner-topic', userId: ownerId, workspaceId: wsId },
      { agentId: agent.id, id: 'teammate-topic', userId: teammateId, workspaceId: wsId },
    ]);

    await handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId });

    const rows = await serverDB.select().from(topics);
    expect(rows.find((t) => t.id === 'owner-topic')?.userId).toBe(ownerId);
    expect(rows.find((t) => t.id === 'teammate-topic')?.userId).toBe(teammateId);
  });

  it('migrates only the previous owner’s topics/messages/threads with migrateSessions', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(topics).values([
      { agentId: agent.id, id: 'owner-topic', userId: ownerId, workspaceId: wsId },
      { agentId: agent.id, id: 'teammate-topic', userId: teammateId, workspaceId: wsId },
    ]);
    await serverDB.insert(messages).values([
      {
        agentId: agent.id,
        id: 'owner-msg',
        role: 'assistant',
        topicId: 'owner-topic',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        id: 'teammate-msg',
        role: 'assistant',
        topicId: 'teammate-topic',
        userId: teammateId,
        workspaceId: wsId,
      },
    ]);
    await serverDB.insert(threads).values([
      {
        agentId: agent.id,
        id: 'owner-thread',
        topicId: 'owner-topic',
        type: 'continuation',
        userId: ownerId,
      },
      {
        agentId: agent.id,
        id: 'teammate-thread',
        topicId: 'teammate-topic',
        type: 'continuation',
        userId: teammateId,
      },
    ]);

    const result = await handover({
      agentId: agent.id,
      fromUserId: ownerId,
      migrateSessions: true,
      toUserId: recipientId,
    });
    expect(result.transferJobId).toBeNull();

    const topicRows = await serverDB.select().from(topics);
    expect(topicRows.find((t) => t.id === 'owner-topic')?.userId).toBe(recipientId);
    expect(topicRows.find((t) => t.id === 'owner-topic')?.workspaceId).toBe(wsId);
    expect(topicRows.find((t) => t.id === 'teammate-topic')?.userId).toBe(teammateId);

    const messageRows = await serverDB.select().from(messages);
    expect(messageRows.find((m) => m.id === 'owner-msg')?.userId).toBe(recipientId);
    expect(messageRows.find((m) => m.id === 'teammate-msg')?.userId).toBe(teammateId);

    const threadRows = await serverDB.select().from(threads);
    expect(threadRows.find((t) => t.id === 'owner-thread')?.userId).toBe(recipientId);
    expect(threadRows.find((t) => t.id === 'teammate-thread')?.userId).toBe(teammateId);
  });

  it('moves the previous owner’s topicless messages, leaving teammates’ residual rows', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.insert(messages).values([
      {
        agentId: agent.id,
        id: 'owner-residual',
        role: 'assistant',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        id: 'teammate-residual',
        role: 'assistant',
        userId: teammateId,
        workspaceId: wsId,
      },
    ]);

    await handover({
      agentId: agent.id,
      fromUserId: ownerId,
      migrateSessions: true,
      toUserId: recipientId,
    });

    const rows = await serverDB.select().from(messages);
    expect(rows.find((m) => m.id === 'owner-residual')?.userId).toBe(recipientId);
    expect(rows.find((m) => m.id === 'teammate-residual')?.userId).toBe(teammateId);
  });

  it('drains topicless residual rows through the backfill job with owner scoping', async () => {
    process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD = '0';
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB
      .insert(topics)
      .values([{ agentId: agent.id, id: 'drain-topic', userId: ownerId, workspaceId: wsId }]);
    await serverDB.insert(messages).values([
      {
        agentId: agent.id,
        id: 'drain-topic-msg',
        role: 'assistant',
        topicId: 'drain-topic',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        id: 'drain-owner-residual',
        role: 'assistant',
        userId: ownerId,
        workspaceId: wsId,
      },
      {
        agentId: agent.id,
        id: 'drain-teammate-residual',
        role: 'assistant',
        userId: teammateId,
        workspaceId: wsId,
      },
    ]);

    const result = await handover({
      agentId: agent.id,
      fromUserId: ownerId,
      migrateSessions: true,
      toUserId: recipientId,
    });
    expect(result.transferJobId).not.toBeNull();

    let done = false;
    while (!done) {
      ({ done } = await AgentTransferJobModel.processNextTopic(serverDB, result.transferJobId!));
    }

    const rows = await serverDB.select().from(messages);
    expect(rows.find((m) => m.id === 'drain-topic-msg')?.userId).toBe(recipientId);
    expect(rows.find((m) => m.id === 'drain-owner-residual')?.userId).toBe(recipientId);
    expect(rows.find((m) => m.id === 'drain-teammate-residual')?.userId).toBe(teammateId);
  });

  it('records a backfill job instead of rewriting large histories inline', async () => {
    process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD = '0';
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB
      .insert(topics)
      .values([{ agentId: agent.id, id: 'big-topic', userId: ownerId, workspaceId: wsId }]);
    await serverDB.insert(messages).values([
      {
        agentId: agent.id,
        id: 'big-msg',
        role: 'assistant',
        topicId: 'big-topic',
        userId: ownerId,
        workspaceId: wsId,
      },
    ]);

    const result = await handover({
      agentId: agent.id,
      fromUserId: ownerId,
      migrateSessions: true,
      toUserId: recipientId,
    });

    expect(result.transferJobId).not.toBeNull();
    // The job owns the message rewrite; the row still carries the old scope.
    const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'big-msg'));
    expect(msg.userId).toBe(ownerId);
    // The junction registers the agent so later transfers see the pending job.
    await expect(AgentTransferJobModel.hasPendingJobForAgents(serverDB, [agent.id])).resolves.toBe(
      true,
    );

    // A second handover while the backfill is pending is refused.
    await expect(
      handover({ agentId: agent.id, fromUserId: recipientId, toUserId: teammateId }),
    ).rejects.toThrow(AGENT_TRANSFER_IN_PROGRESS);
  });

  it('rejects a stale request when the owner already changed', async () => {
    const agent = await ownerModel.create({ title: 'Agent' });
    await serverDB.update(agents).set({ userId: teammateId }).where(eq(agents.id, agent.id));

    await expect(
      handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId }),
    ).rejects.toThrow(AGENT_OWNERSHIP_STALE);
  });

  it('rejects when the agent is no longer in the workspace', async () => {
    const personalModel = new AgentModel(serverDB, ownerId);
    const agent = await personalModel.create({ title: 'Personal Agent' });

    await expect(
      handover({ agentId: agent.id, fromUserId: ownerId, toUserId: recipientId }),
    ).rejects.toThrow(AGENT_OWNERSHIP_STALE);
  });
});
