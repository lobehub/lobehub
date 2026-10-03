// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agentInboxMessages, agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';
import { AgentInboxModel } from '../agentInbox';

const serverDB: LobeChatDatabase = await getTestDB();

/** user1 owns both agents; user2 is a fellow member of the same workspace. */
const ownerId = 'agent-inbox-owner';
const memberId = 'agent-inbox-member';
const workspaceId = 'agent-inbox-visibility-ws';
const privateAgentId = 'agent-inbox-private-agent';
const publicAgentId = 'agent-inbox-public-agent';

const scope = { userId: ownerId, workspaceId };

const deliver = async (agentId: string, identifier: string, providerMessageId: string) => {
  const account = await new AgentAccountModel(serverDB, ownerId, undefined, workspaceId).create({
    agentId,
    capabilities: { receive: true, send: true },
    identifier,
    kind: 'mail',
    provider: 'agent-mail',
  });

  const { message } = await AgentInboxModel.record(
    serverDB,
    {
      accountId: account.id,
      agentId,
      codes: ['839201'],
      from: 'login@service.com',
      kind: 'mail',
      provider: 'agent-mail',
      providerMessageId,
      receivedAt: new Date('2026-10-02T12:00:00.000Z'),
      subject: 'Your verification code',
      text: 'Your verification code is 839201.',
      to: identifier,
    },
    scope,
  );

  return message;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: workspaceId, primaryOwnerId: ownerId, slug: workspaceId })
    .onConflictDoNothing();
  await serverDB.insert(agents).values([
    { id: privateAgentId, userId: ownerId, visibility: 'private', workspaceId },
    { id: publicAgentId, userId: ownerId, visibility: 'public', workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(agentInboxMessages);
  await serverDB.delete(agentAccounts);
  await serverDB.delete(agents);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('AgentInboxModel workspace isolation by agent visibility', () => {
  it('keeps a private agent inbox (codes included) away from another member', async () => {
    const privateMessage = await deliver(privateAgentId, 'private@lobe.id', 'msg_private');
    const member = new AgentInboxModel(serverDB, memberId, workspaceId);

    expect(await member.list({ agentId: privateAgentId })).toEqual([]);
    expect(await member.findById(privateMessage.id)).toBeUndefined();
    expect(await member.unreadCount(privateAgentId)).toBe(0);

    // Writes are scoped the same way: the member cannot clear the owner's unread mark.
    expect(await member.markRead([privateMessage.id])).toBe(0);
    expect(await member.markAllRead(privateAgentId)).toBe(0);

    const owner = new AgentInboxModel(serverDB, ownerId, workspaceId);
    expect(await owner.list({ agentId: privateAgentId })).toEqual([
      expect.objectContaining({ codes: ['839201'], id: privateMessage.id, readAt: null }),
    ]);
  });

  it('still shares the inbox of a public workspace agent', async () => {
    const publicMessage = await deliver(publicAgentId, 'public@lobe.id', 'msg_public');
    const member = new AgentInboxModel(serverDB, memberId, workspaceId);

    expect(await member.list({ agentId: publicAgentId })).toEqual([
      expect.objectContaining({ id: publicMessage.id }),
    ]);
    expect(await member.unreadCount(publicAgentId)).toBe(1);
  });
});

describe('AgentInboxModel.claimWake', () => {
  it('lets exactly one of several concurrent workers wake a delivery, and can be given back', async () => {
    const message = await deliver(publicAgentId, 'claim@lobe.id', 'msg_claim');

    const results = await Promise.all([
      AgentInboxModel.claimWake(serverDB, message.id),
      AgentInboxModel.claimWake(serverDB, message.id),
      AgentInboxModel.claimWake(serverDB, message.id),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    // A failed wake hands the claim back so the provider's retry can wake it.
    await AgentInboxModel.releaseWake(serverDB, message.id);
    expect(await AgentInboxModel.claimWake(serverDB, message.id)).toBe(true);

    // Once woken (read), it can never be claimed again.
    await AgentInboxModel.markWoken(serverDB, message.id, undefined);
    await AgentInboxModel.releaseWake(serverDB, message.id);
    expect(await AgentInboxModel.claimWake(serverDB, message.id)).toBe(false);
  });
});
