// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { ContactModel } from '../../../models/contact';
import { agents, userContacts } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture, jobsOf } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-peer');

const alice = fixture.ownerId;
const bob = fixture.memberId;
const asAlice = new ChannelRepository(db, alice);
const asBob = new ChannelRepository(db, bob);

const befriend = async () => {
  const { requestId } = await new ContactModel(db, alice).sendRequest(bob);
  await new ContactModel(db, bob).acceptRequest(requestId);
};

beforeEach(fixture.setup);
afterEach(async () => {
  await db.delete(userContacts);
  await fixture.cleanup();
});

describe('a conversation between two contacts', () => {
  it('requires the mutual contact relation', async () => {
    await expect(asAlice.openPeer(bob, 'Mia')).rejects.toThrow('You are not contacts');
    await new ContactModel(db, alice).sendRequest(bob);
    await expect(asAlice.openPeer(bob, 'Mia')).rejects.toThrow('You are not contacts');
  });

  it('is one conversation per pair, whoever opens it', async () => {
    await befriend();
    const opened = await asAlice.openPeer(bob, 'Mia');
    const reopened = await asBob.openPeer(alice, 'Olivia');
    expect(reopened.channel.id).toBe(opened.channel.id);
    expect(opened.channel).toMatchObject({ agentId: null, peerUserId: bob, workspaceId: null });
  });

  it('stays one conversation when both people open it at once', async () => {
    await befriend();
    const opened = await Promise.all([
      asAlice.openPeer(bob, 'Mia'),
      asBob.openPeer(alice, 'Olivia'),
      asAlice.openPeer(bob, 'Mia'),
    ]);
    expect(new Set(opened.map(({ channel }) => channel.id)).size).toBe(1);
    expect(await asAlice.list()).toHaveLength(1);
  });

  it('is listed for both people with the other person', async () => {
    await befriend();
    const { channel } = await asAlice.openPeer(bob, 'Mia');

    const [forAlice] = await asAlice.list();
    expect(forAlice).toMatchObject({ id: channel.id, peerUserId: bob });
    expect(forAlice.memberAvatars.map((m) => m.id)).toEqual([bob]);
    const [forBob] = await asBob.list();
    expect(forBob).toMatchObject({ id: channel.id, peerUserId: alice });
  });

  it('carries messages without waking any Agent', async () => {
    await befriend();
    const { channel } = await asAlice.openPeer(bob, 'Mia');
    const message = await asAlice.send(channel.id, {
      content: 'Hi Mia',
      requestKey: 'hi',
      routing: 'fallback',
    });
    expect(message.routingStatus).toBe('skipped');
    expect(await jobsOf(db, message.id)).toEqual([]);
    const [forBob] = await asBob.list();
    expect(forBob.unreadCount).toBe(1);
  });

  it('takes no Agents and no third person', async () => {
    await befriend();
    const { channel } = await asAlice.openPeer(bob, 'Mia');
    const [agent] = await db.insert(agents).values({ title: 'Helper', userId: alice }).returning();
    await expect(asAlice.addAgent(channel.id, { agentId: agent.id })).rejects.toThrow(
      'A conversation between two people has no Agents',
    );
  });

  it('goes silent once either person removes the other', async () => {
    await befriend();
    const { channel } = await asAlice.openPeer(bob, 'Mia');
    await new ContactModel(db, bob).removeUser(alice);
    await expect(
      asAlice.send(channel.id, { content: 'Still there?', requestKey: 'x', routing: 'fallback' }),
    ).rejects.toThrow('You are not contacts');
    // History stays readable.
    expect((await asAlice.list()).map((c) => c.id)).toEqual([channel.id]);
  });

  it('is never opened in a workspace', async () => {
    await befriend();
    await expect(
      new ChannelRepository(db, alice, fixture.workspaceId).openPeer(bob, 'Mia'),
    ).rejects.toThrow('A conversation between people is personal');
  });
});
