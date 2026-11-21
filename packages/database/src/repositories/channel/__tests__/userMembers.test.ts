// @vitest-environment node
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers, channels, userContacts, workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-user-members');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(async () => {
  await db.delete(userContacts);
  await fixture.cleanup();
});

/** Makes two people personal contacts, in both directions as an accepted request does. */
const befriend = (a: string, b: string) =>
  db.insert(userContacts).values([
    { contactUserId: b, type: 'user', userId: a },
    { contactUserId: a, type: 'user', userId: b },
  ]);

const create = async () => {
  const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await owner.create({ title: 'People' });
  return { channel, owner };
};

describe('Channel human membership', () => {
  it('lets an admin find and add a workspace member, then share messages without granting admin', async () => {
    const { owner, channel } = await create();
    expect(await owner.userCandidates(channel.id, 'mia')).toEqual([
      expect.objectContaining({ userId: fixture.memberId, username: 'mia' }),
    ]);
    const added = await owner.addUser(channel.id, fixture.memberId);
    expect(added).toMatchObject({ role: 'member', status: 'active', userId: fixture.memberId });
    expect((await owner.addUser(channel.id, fixture.memberId)).id).toBe(added.id);
    expect(await owner.userCandidates(channel.id)).toEqual([]);
    const member = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    expect(await member.list()).toEqual([
      expect.objectContaining({ id: channel.id, canDelete: false }),
    ]);
    await member.send(channel.id, {
      content: 'Hello owner',
      requestKey: 'hello',
      routing: 'fallback',
    });
    expect((await owner.detail(channel.id)).messages[0]).toMatchObject({
      content: 'Hello owner',
      userId: fixture.memberId,
    });
    await expect(member.remove(channel.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(member.addUser(channel.id, fixture.ownerId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(member.userCandidates(channel.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects non-workspace and removed users without inserting membership', async () => {
    const { owner, channel } = await create();
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, fixture.workspaceId),
          eq(workspaceMembers.userId, fixture.memberId),
        ),
      );
    expect(await owner.userCandidates(channel.id)).toEqual([]);
    await expect(owner.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(owner.addUser(channel.id, 'outside-user')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await owner.detail(channel.id)).members).toHaveLength(1);
  });

  it('rejects wrong-scope, direct and trashed channels', async () => {
    const { owner, channel } = await create();
    const personal = new ChannelRepository(db, fixture.ownerId);
    await expect(personal.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const agent = await fixture.addAgent(channel.id, 'Direct');
    const direct = await owner.create({ agentId: agent.agentId!, title: 'Direct' });
    await expect(owner.addUser(direct.channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await owner.remove(channel.id);
    await expect(owner.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('reactivates a retained member without resurrecting their former admin role', async () => {
    const { owner, channel } = await create();
    const previous = await fixture.addPerson(channel.id, fixture.memberId, 'admin');
    await db
      .update(channelMembers)
      .set({ status: 'left' })
      .where(eq(channelMembers.id, previous.id));
    expect(await owner.addUser(channel.id, fixture.memberId)).toMatchObject({
      id: previous.id,
      role: 'member',
      status: 'active',
    });
  });

  it('does not let a removed workspace administrator invite people using a retained channel role', async () => {
    const { owner, channel } = await create();
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, fixture.ownerId));
    await expect(owner.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(owner.userCandidates(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  describe('starting a Channel with people', () => {
    it('lists everyone in the workspace except the creator, and adds the chosen people', async () => {
      const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
      expect(await owner.newChannelUserCandidates()).toEqual([
        expect.objectContaining({ userId: fixture.memberId, username: 'mia' }),
      ]);
      expect(await owner.newChannelUserCandidates('nobody')).toEqual([]);

      const { channel } = await owner.create({
        title: 'People',
        userIds: [fixture.memberId, fixture.memberId, fixture.ownerId],
      });
      expect(channel.agentId).toBeNull();
      const members = await db
        .select()
        .from(channelMembers)
        .where(eq(channelMembers.channelId, channel.id));
      expect(members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'owner', userId: fixture.ownerId }),
          expect.objectContaining({ role: 'member', status: 'active', userId: fixture.memberId }),
        ]),
      );
      expect(members).toHaveLength(2);
      const member = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
      expect(await member.list()).toEqual([expect.objectContaining({ id: channel.id })]);
    });

    it('starts a group with only its creator, who can invite people later', async () => {
      const { owner, channel } = await create();
      expect(channel.agentId).toBeNull();
      expect(await owner.list()).toEqual([expect.objectContaining({ id: channel.id })]);
      expect((await owner.detail(channel.id)).members).toEqual([
        expect.objectContaining({ role: 'owner', userId: fixture.ownerId }),
      ]);
      await owner.addUser(channel.id, fixture.memberId);
      expect((await owner.detail(channel.id)).members).toHaveLength(2);
    });

    it('creates nothing when a chosen person is outside the workspace', async () => {
      const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
      await expect(
        owner.create({ title: 'People', userIds: [fixture.memberId, 'outside-user'] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(
        await db.select().from(channels).where(eq(channels.workspaceId, fixture.workspaceId)),
      ).toEqual([]);
    });

    it('keeps people out of direct conversations', async () => {
      const { owner, channel } = await create();
      const agent = await fixture.addAgent(channel.id, 'Direct');
      await expect(
        owner.create({ agentId: agent.agentId!, title: 'Direct', userIds: [fixture.memberId] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('does not list workspace people to someone who has left the workspace', async () => {
      await db
        .update(workspaceMembers)
        .set({ deletedAt: new Date() })
        .where(eq(workspaceMembers.userId, fixture.ownerId));
      const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
      await expect(owner.newChannelUserCandidates()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('personal groups', () => {
    it('starts a group with mutual contacts, who then talk in it', async () => {
      await befriend(fixture.ownerId, fixture.memberId);
      const owner = new ChannelRepository(db, fixture.ownerId);
      expect(await owner.newChannelUserCandidates('mia')).toEqual([
        expect.objectContaining({ userId: fixture.memberId, username: 'mia' }),
      ]);
      const { channel } = await owner.create({ title: 'Friends', userIds: [fixture.memberId] });
      expect(channel.workspaceId).toBeNull();

      const member = new ChannelRepository(db, fixture.memberId);
      expect(await member.list()).toEqual([
        expect.objectContaining({ id: channel.id, canDelete: false }),
      ]);
      await member.send(channel.id, { content: 'Hi', requestKey: 'hi', routing: 'fallback' });
      expect((await owner.detail(channel.id)).messages[0]).toMatchObject({
        content: 'Hi',
        userId: fixture.memberId,
      });
      // Workspace people are no one's contacts until they connect personally.
      expect(await new ChannelRepository(db, fixture.ownerId, fixture.workspaceId).list()).toEqual(
        [],
      );
    });

    it('invites mutual contacts into an existing group, and only them', async () => {
      const owner = new ChannelRepository(db, fixture.ownerId);
      const { channel } = await owner.create({ title: 'Friends' });
      expect(await owner.userCandidates(channel.id)).toEqual([]);
      await expect(owner.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });

      // One direction alone is a pending friendship, not a contact.
      await db
        .insert(userContacts)
        .values({ contactUserId: fixture.memberId, type: 'user', userId: fixture.ownerId });
      expect(await owner.userCandidates(channel.id)).toEqual([]);
      await db.delete(userContacts);

      await befriend(fixture.ownerId, fixture.memberId);
      expect(await owner.userCandidates(channel.id)).toEqual([
        expect.objectContaining({ userId: fixture.memberId }),
      ]);
      await owner.addUser(channel.id, fixture.memberId);
      expect(await owner.userCandidates(channel.id)).toEqual([]);
      expect((await owner.detail(channel.id)).members).toHaveLength(2);
    });

    it('does not count workspace contacts as personal ones', async () => {
      await db.insert(userContacts).values([
        {
          contactUserId: fixture.memberId,
          type: 'user',
          userId: fixture.ownerId,
          workspaceId: fixture.workspaceId,
        },
        {
          contactUserId: fixture.ownerId,
          type: 'user',
          userId: fixture.memberId,
          workspaceId: fixture.workspaceId,
        },
      ]);
      const owner = new ChannelRepository(db, fixture.ownerId);
      expect(await owner.newChannelUserCandidates()).toEqual([]);
      await expect(
        owner.create({ title: 'Friends', userIds: [fixture.memberId] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(
        await db.select().from(channels).where(and(eq(channels.userId, fixture.ownerId), isNull(channels.workspaceId))),
      ).toEqual([]);
    });
  });
});
