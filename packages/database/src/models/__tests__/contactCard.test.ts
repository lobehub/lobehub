// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  agentShares,
  userContactRequests,
  userContacts,
  users,
  workspaceMembers,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ContactModel } from '../contact';

const serverDB: LobeChatDatabase = await getTestDB();

const alice = 'card-test-alice';
const bob = 'card-test-bob';
const carol = 'card-test-carol';
const teamId = 'card-test-team';
const aliceShared = 'agt_card_alice_shared';
const alicePrivate = 'agt_card_alice_private';
const bobShared = 'agt_card_bob_shared';
const teamAgent = 'agt_card_team';

const aliceModel = new ContactModel(serverDB, alice);
const bobModel = new ContactModel(serverDB, bob);

let bobShareId: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { fullName: 'Alice', id: alice, username: 'alice' },
    { fullName: 'Bob', id: bob, username: 'bob' },
    { id: carol, username: 'carol' },
  ]);
  await serverDB
    .insert(workspaces)
    .values({ id: teamId, name: 'Team', primaryOwnerId: alice, slug: teamId });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: alice, workspaceId: teamId },
    { role: 'member', userId: carol, workspaceId: teamId },
  ]);
  await serverDB.insert(agents).values([
    { id: aliceShared, title: 'Writer', userId: alice },
    { id: alicePrivate, title: 'Diary', userId: alice },
    { id: bobShared, title: 'Bob Helper', userId: bob },
    { id: teamAgent, title: 'Team Bot', userId: carol, workspaceId: teamId },
  ]);
  const shares = await serverDB
    .insert(agentShares)
    .values([
      { agentId: aliceShared, shareConfig: { monthlySpendLimit: 1 }, visibility: 'link' },
      { agentId: bobShared, shareConfig: { monthlySpendLimit: 1 }, visibility: 'link' },
      { agentId: teamAgent, shareConfig: { monthlySpendLimit: 1 }, visibility: 'link' },
    ])
    .returning();
  bobShareId = shares.find((share) => share.agentId === bobShared)!.id;
});

afterEach(async () => {
  await serverDB.delete(userContactRequests);
  await serverDB.delete(userContacts);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

const befriend = async (a: string, b: string) => {
  const { requestId } = await new ContactModel(serverDB, a).sendRequest(b);
  await new ContactModel(serverDB, b).acceptRequest(requestId);
};

describe('resolveCard: people', () => {
  it('shares a contact or yourself, with their public profile', async () => {
    await befriend(alice, bob);
    await expect(aliceModel.resolveCard({ type: 'user', userId: bob })).resolves.toEqual({
      type: 'user',
      user: { avatar: null, fullName: 'Bob', id: bob, username: 'bob' },
    });
    await expect(aliceModel.resolveCard({ type: 'user', userId: alice })).resolves.toMatchObject({
      user: { id: alice },
    });
  });

  it('shares a fellow member inside the workspace', async () => {
    const aliceInTeam = new ContactModel(serverDB, alice, teamId);
    await expect(aliceInTeam.resolveCard({ type: 'user', userId: carol })).resolves.toMatchObject({
      user: { id: carol },
    });
  });

  it('refuses a stranger, even one with a pending request', async () => {
    await aliceModel.sendRequest(bob);
    await expect(aliceModel.resolveCard({ type: 'user', userId: bob })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'CONTACT_NOT_SHAREABLE',
    });
    await expect(aliceModel.resolveCard({ type: 'user', userId: carol })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('resolveCard: Agents', () => {
  it('shares your own link-shared Agent with its share', async () => {
    const card = await aliceModel.resolveCard({ agentId: aliceShared, type: 'agent' });
    expect(card).toMatchObject({
      agent: { agentId: aliceShared, owner: { id: alice }, title: 'Writer' },
      type: 'agent',
    });
    expect(card.type === 'agent' && card.agent.shareId).toBeTruthy();
  });

  it('refuses your own Agent until it is shared by link', async () => {
    await expect(
      aliceModel.resolveCard({ agentId: alicePrivate, type: 'agent' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'AGENT_NOT_SHARED' });
  });

  it('shares another person’s Agent only once it is in your address book', async () => {
    await expect(
      aliceModel.resolveCard({ agentId: bobShared, type: 'agent' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await aliceModel.addAgent(bobShareId);
    await expect(
      aliceModel.resolveCard({ agentId: bobShared, type: 'agent' }),
    ).resolves.toMatchObject({ agent: { agentId: bobShared, shareId: bobShareId } });
  });

  it('shares the workspace’s Agents inside it, not from the personal space', async () => {
    const aliceInTeam = new ContactModel(serverDB, alice, teamId);
    await expect(
      aliceInTeam.resolveCard({ agentId: teamAgent, type: 'agent' }),
    ).resolves.toMatchObject({ agent: { agentId: teamAgent } });
    await expect(
      aliceModel.resolveCard({ agentId: teamAgent, type: 'agent' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not reveal a trashed Agent', async () => {
    await expect(
      bobModel.resolveCard({ agentId: 'agt_card_missing', type: 'agent' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('request source', () => {
  it('lists who recommended the requester through a card, on both sides', async () => {
    const source = {
      channelId: 'chn_cardtest0001',
      messageId: '00000000-0000-4000-8000-000000000001',
      sharedById: carol,
      type: 'card' as const,
    };
    await aliceModel.sendRequest(bob, 'hi', source);

    const [incoming] = await bobModel.listRequests();
    expect(incoming).toMatchObject({
      direction: 'incoming',
      source: { sharedBy: { id: carol, username: 'carol' }, type: 'card' },
      user: { id: alice },
    });
    const [outgoing] = await aliceModel.listRequests();
    expect(outgoing.source).toMatchObject({ sharedBy: { id: carol } });
  });

  it('lists a request without a source, or whose sharer is gone, with none', async () => {
    await aliceModel.sendRequest(bob);
    expect((await bobModel.listRequests())[0].source).toBeNull();

    await serverDB.delete(userContactRequests);
    await aliceModel.sendRequest(bob, undefined, {
      channelId: 'chn_cardtest0001',
      messageId: '00000000-0000-4000-8000-000000000001',
      sharedById: 'card-test-deleted',
      type: 'card',
    });
    expect((await bobModel.listRequests())[0].source).toBeNull();
  });
});
