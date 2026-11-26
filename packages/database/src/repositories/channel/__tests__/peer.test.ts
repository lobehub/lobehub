// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, files, userContacts, users, workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { tableContacts } from './tableContacts';
import { createChannelFixture, jobsOf } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-peer', tableContacts);

const alice = fixture.ownerId;
const bob = fixture.memberId;
const asAlice = new ChannelRepository(db, alice, undefined, tableContacts);
const asBob = new ChannelRepository(db, bob, undefined, tableContacts);

/** One direction of a contact relation in a scope; both make two people contacts. */
const addContact = (userId: string, contactUserId: string, workspaceId: string | null = null) =>
  db.insert(userContacts).values({ contactUserId, type: 'user', userId, workspaceId });
const pair = async (a: string, b: string, workspaceId: string | null = null) => {
  await addContact(a, b, workspaceId);
  await addContact(b, a, workspaceId);
};
const dropContact = (userId: string, contactUserId: string) =>
  db
    .delete(userContacts)
    .where(and(eq(userContacts.userId, userId), eq(userContacts.contactUserId, contactUserId)));

const befriend = () => pair(alice, bob);

beforeEach(fixture.setup);
afterEach(async () => {
  await db.delete(userContacts);
  await fixture.cleanup();
});

describe('a conversation between two contacts', () => {
  it('requires the mutual contact relation', async () => {
    await expect(asAlice.openPeer(bob, 'Mia')).rejects.toThrow('You are not contacts');
    await addContact(alice, bob);
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
    await dropContact(bob, alice);
    await expect(
      asAlice.send(channel.id, { content: 'Still there?', requestKey: 'x', routing: 'fallback' }),
    ).rejects.toThrow('You are not contacts');
    // History stays readable.
    expect((await asAlice.list()).map((c) => c.id)).toEqual([channel.id]);
  });
});

describe('a conversation between two workspace members', () => {
  const inTeam = (userId: string) =>
    new ChannelRepository(db, userId, fixture.workspaceId, tableContacts);
  const join = (...userIds: string[]) =>
    db
      .insert(workspaceMembers)
      .values(
        userIds.map((userId) => ({ role: 'member', userId, workspaceId: fixture.workspaceId })),
      )
      .onConflictDoNothing();

  it('needs both people to be members, not contacts', async () => {
    await join(alice);
    await expect(inTeam(alice).openPeer(bob, 'Mia')).rejects.toThrow('Workspace member not found');

    await join(bob);
    const { channel } = await inTeam(alice).openPeer(bob, 'Mia');
    expect(channel).toMatchObject({ peerUserId: bob, workspaceId: fixture.workspaceId });
    expect(await inTeam(bob).list()).toMatchObject([{ id: channel.id, peerUserId: alice }]);
  });

  it('is its own conversation, apart from the personal one', async () => {
    await befriend();
    await join(alice, bob);
    const personal = await asAlice.openPeer(bob, 'Mia');
    const inWorkspace = await inTeam(bob).openPeer(alice, 'Olivia');
    expect(inWorkspace.channel.id).not.toBe(personal.channel.id);
    expect((await inTeam(alice).openPeer(bob, 'Mia')).channel.id).toBe(inWorkspace.channel.id);

    expect((await asAlice.list()).map((c) => c.id)).toEqual([personal.channel.id]);
    expect((await inTeam(alice).list()).map((c) => c.id)).toEqual([inWorkspace.channel.id]);
  });

  it('goes silent once either person leaves the workspace', async () => {
    await join(alice, bob);
    const { channel } = await inTeam(alice).openPeer(bob, 'Mia');
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, fixture.workspaceId),
          eq(workspaceMembers.userId, bob),
        ),
      );
    await expect(
      inTeam(alice).send(channel.id, {
        content: 'Still here?',
        requestKey: 'x',
        routing: 'fallback',
      }),
    ).rejects.toThrow('Workspace member not found');
  });
});

describe('a conversation with an external contact of a workspace', () => {
  const carol = 'channel-peer-carol';
  const inTeam = (userId: string) =>
    new ChannelRepository(db, userId, fixture.workspaceId, tableContacts);

  /** Alice and Carol are members; Alice invites Bob, who stays outside the workspace. */
  const inviteBob = async () => {
    await db.insert(users).values({ id: carol }).onConflictDoNothing();
    await db.insert(workspaceMembers).values(
      [alice, carol].map((userId) => ({
        role: 'member',
        userId,
        workspaceId: fixture.workspaceId,
      })),
    );
    await pair(alice, bob, fixture.workspaceId);
  };

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, carol));
  });

  it('is open between the external contact and the members paired with them', async () => {
    await inviteBob();
    const { channel } = await inTeam(bob).openPeer(alice, 'Olivia');
    expect(channel).toMatchObject({ peerUserId: alice, workspaceId: fixture.workspaceId });
    expect((await inTeam(alice).openPeer(bob, 'Mia')).channel.id).toBe(channel.id);

    // Carol has not opened herself to Bob, so neither of them can start one.
    await expect(inTeam(bob).openPeer(carol, 'Carol')).rejects.toThrow(
      'Workspace member not found',
    );
    await expect(inTeam(carol).openPeer(bob, 'Mia')).rejects.toThrow('Workspace member not found');
    await pair(carol, bob, fixture.workspaceId);
    expect(await inTeam(carol).openPeer(bob, 'Mia')).toBeDefined();
  });

  it('lets them attach only files they uploaded, never one of the workspace’s', async () => {
    await inviteBob();
    const upload = async (userId: string, workspaceId: string | null) => {
      const [file] = await db
        .insert(files)
        .values({
          fileType: 'text/plain',
          name: 'f.txt',
          size: 1,
          url: 'files/f',
          userId,
          workspaceId,
        })
        .returning();
      return file.id;
    };
    // A public file of the workspace, which any member may attach.
    const teamFile = await upload(carol, fixture.workspaceId);
    const { channel } = await inTeam(bob).openPeer(alice, 'Olivia');
    const send = (userId: string, fileId: string) =>
      inTeam(userId).send(channel.id, {
        content: 'See this',
        fileIds: [fileId],
        requestKey: `${userId}-${fileId}`,
        routing: 'fallback',
      });

    await expect(send(bob, teamFile)).rejects.toThrow(ChatErrorType.ChannelAttachmentUnavailable);
    // His own upload, which the file router stores in his personal space, goes through.
    expect(await send(bob, await upload(bob, null))).toBeDefined();
    // A member still attaches the workspace's file.
    expect(await send(alice, teamFile)).toBeDefined();
  });

  it('goes silent once the member closes themselves to them', async () => {
    await inviteBob();
    const { channel } = await inTeam(alice).openPeer(bob, 'Mia');
    await dropContact(alice, bob);
    await expect(
      inTeam(bob).send(channel.id, { content: 'Hello?', requestKey: 'x', routing: 'fallback' }),
    ).rejects.toThrow('Workspace member not found');
  });
});
