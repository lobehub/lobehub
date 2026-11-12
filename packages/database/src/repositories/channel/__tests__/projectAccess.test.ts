// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers, projects, workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-project-access');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(async () => {
  await db.delete(projects).where(eq(projects.workspaceId, fixture.workspaceId));
  await fixture.cleanup();
});

/** A project of the owner's with one Channel and one message, which the teammate did not join. */
const projectChannel = async (visibility: 'private' | 'public' = 'public') => {
  const [project] = await db
    .insert(projects)
    .values({
      name: 'Apollo',
      userId: fixture.ownerId,
      visibility,
      workspaceId: fixture.workspaceId,
    })
    .returning();
  const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await owner.create({ projectId: project.id, title: 'General' });
  await owner.send(channel.id, { content: 'Kickoff', requestKey: 'kickoff', routing: 'fallback' });
  const teammate = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
  return { channel, owner, project, teammate };
};

const membershipOf = (channelId: string) =>
  db
    .select()
    .from(channelMembers)
    .where(
      and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, fixture.memberId)),
    );

describe('open project Channels', () => {
  it("lists a readable project's Channels to a teammate as not joined, with nothing unread", async () => {
    const { channel, teammate } = await projectChannel();

    expect(await teammate.list()).toEqual([
      expect.objectContaining({
        canDelete: false,
        id: channel.id,
        joined: false,
        lastMessage: expect.objectContaining({ content: 'Kickoff' }),
        unreadCount: 0,
      }),
    ]);
  });

  it('lets a teammate read without joining, with no member actions', async () => {
    const { channel, teammate } = await projectChannel();

    const detail = await teammate.detail(channel.id);

    expect(detail).toMatchObject({ channel: { canDelete: false }, joined: false });
    expect(detail.messages.map((message) => message.content)).toEqual(['Kickoff']);
    expect(await membershipOf(channel.id)).toEqual([]);
    await expect(teammate.markRead(channel.id, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(teammate.rename(channel.id, 'Mine')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('joins a teammate on their first message, starting from what they already saw', async () => {
    const { channel, owner, teammate } = await projectChannel();

    await teammate.send(channel.id, { content: 'Hi', requestKey: 'hi', routing: 'fallback' });

    expect(await membershipOf(channel.id)).toEqual([
      expect.objectContaining({ lastReadSequence: 1, role: 'member', status: 'active' }),
    ]);
    expect(await teammate.list()).toEqual([
      expect.objectContaining({ id: channel.id, joined: true, unreadCount: 1 }),
    ]);
    const joinedView = await teammate.detail(channel.id);
    expect(joinedView.joined).toBe(true);
    // The join line credits no inviter: the teammate joined by themselves.
    expect(joinedView.members.find((member) => member.userId === fixture.memberId)).toMatchObject({
      selfJoined: true,
    });
    expect(joinedView.members.find((member) => member.userId === fixture.ownerId)?.selfJoined).toBe(
      false,
    );
    expect((await owner.detail(channel.id)).messages.map((message) => message.content)).toEqual([
      'Kickoff',
      'Hi',
    ]);
  });

  it('joins explicitly, once', async () => {
    const { channel, teammate } = await projectChannel();

    const first = await teammate.join(channel.id);
    const again = await teammate.join(channel.id);

    expect(again.member.id).toBe(first.member.id);
    expect(await membershipOf(channel.id)).toHaveLength(1);
  });

  it("keeps a private project's Channels with their members", async () => {
    const { channel, teammate } = await projectChannel('private');

    expect(await teammate.list()).toEqual([]);
    await expect(teammate.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      teammate.send(channel.id, { content: 'Hi', requestKey: 'hi', routing: 'fallback' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stays closed to people outside the workspace, other scopes and removed members', async () => {
    const { channel, teammate } = await projectChannel();

    // Personal scope sees no workspace Channel.
    const personal = new ChannelRepository(db, fixture.memberId);
    expect(await personal.list()).toEqual([]);
    await expect(personal.join(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Removed by an admin: neither listed nor readable, and cannot rejoin.
    await db.insert(channelMembers).values({
      actorType: 'user',
      channelId: channel.id,
      role: 'member',
      status: 'removed',
      userId: fixture.memberId,
    });
    expect(await teammate.list()).toEqual([]);
    await expect(teammate.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(teammate.join(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('closes the Channels to someone who left the workspace, or never belonged', async () => {
    const { channel, teammate } = await projectChannel();
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, fixture.workspaceId),
          eq(workspaceMembers.userId, fixture.memberId),
        ),
      );

    expect(await teammate.list()).toEqual([]);
    await expect(teammate.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(teammate.join(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await membershipOf(channel.id)).toEqual([]);

    // An outsider naming the workspace gets nothing either.
    const outsider = new ChannelRepository(
      db,
      'channel-project-access-outsider',
      fixture.workspaceId,
    );
    expect(await outsider.list()).toEqual([]);
    await expect(outsider.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('opens neither archived nor trashed Channels to newcomers', async () => {
    const { channel, owner, teammate } = await projectChannel();
    await owner.archive(channel.id);

    expect(await teammate.list()).toEqual([]);
    await expect(teammate.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(teammate.join(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Its members still read it.
    expect((await owner.detail(channel.id)).joined).toBe(true);

    await owner.unarchive(channel.id);
    await owner.remove(channel.id);
    expect(await teammate.list()).toEqual([]);
    await expect(teammate.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
