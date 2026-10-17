// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agentInboxMessages, agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';
import { AgentInboxModel, WAKE_CLAIM_LEASE_SECONDS } from '../agentInbox';
import { AgentMailModel } from '../agentMail';

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

  const { mail } = await AgentMailModel.record(
    serverDB,
    {
      accountId: account.id,
      agentId,
      codes: ['839201'],
      deliveredAt: new Date('2026-10-02T12:00:00.000Z'),
      direction: 'inbound',
      fromAddress: 'login@service.com',
      provider: 'agent-mail',
      providerMessageId,
      subject: 'Your verification code',
      text: 'Your verification code is 839201.',
      to: [{ address: identifier }],
    },
    scope,
  );

  const { item } = await AgentInboxModel.deliver(
    serverDB,
    {
      accountId: account.id,
      agentId,
      receivedAt: mail.deliveredAt,
      sender: mail.fromAddress,
      sourceId: mail.id,
      sourceType: 'mail',
      title: mail.subject,
    },
    scope,
  );

  return item;
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

  it('lets a retry take over a claim whose worker died before waking or releasing it', async () => {
    const message = await deliver(publicAgentId, 'lease@lobe.id', 'msg_lease');
    expect(await AgentInboxModel.claimWake(serverDB, message.id)).toBe(true);

    // A live claim still refuses the retry.
    expect(await AgentInboxModel.claimWake(serverDB, message.id)).toBe(false);

    // The worker died: nothing released the claim, and its lease ran out.
    await serverDB
      .update(agentInboxMessages)
      .set({
        wakeClaimedAt: sql`now() - make_interval(secs => ${WAKE_CLAIM_LEASE_SECONDS + 60})`,
      })
      .where(eq(agentInboxMessages.id, message.id));

    expect(await AgentInboxModel.claimWake(serverDB, message.id)).toBe(true);
    expect(await AgentInboxModel.claimWake(serverDB, message.id)).toBe(false);

    // A finished wake is never taken over, however old its claim.
    await AgentInboxModel.markWoken(serverDB, message.id, undefined);
    await serverDB
      .update(agentInboxMessages)
      .set({
        wakeClaimedAt: sql`now() - make_interval(secs => ${WAKE_CLAIM_LEASE_SECONDS + 60})`,
      })
      .where(eq(agentInboxMessages.id, message.id));
    expect(await AgentInboxModel.claimWake(serverDB, message.id)).toBe(false);
  });
});
