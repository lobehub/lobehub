// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers, workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-workspace-manager');

const setWorkspaceRole = (role: string) =>
  db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, fixture.workspaceId),
        eq(workspaceMembers.userId, fixture.memberId),
      ),
    );

beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(fixture.cleanup);

/** A group Channel `creatorId` created, which `joinerId` joined as a plain member. */
const joinAsMember = async (creatorId = fixture.ownerId, joinerId = fixture.memberId) => {
  const creator = new ChannelRepository(db, creatorId, fixture.workspaceId);
  const { channel } = await creator.create({ title: 'Marketing', userIds: [joinerId] });
  const member = new ChannelRepository(db, joinerId, fixture.workspaceId);
  return { channel, member };
};

describe('workspace owners and admins in group Channels', () => {
  it.each([
    // Mia is promoted to workspace admin and joins Olivia's Channel.
    { creatorId: fixture.ownerId, joinerId: fixture.memberId, role: 'admin' },
    // Olivia owns the workspace and joins Mia's Channel.
    { creatorId: fixture.memberId, joinerId: fixture.ownerId, role: 'owner' },
  ])(
    'lets a workspace $role manage a Channel they joined as a member',
    async ({ creatorId, joinerId, role }) => {
      if (role === 'admin') await setWorkspaceRole('admin');
      const { channel, member } = await joinAsMember(creatorId, joinerId);

      expect(await member.list()).toEqual([
        expect.objectContaining({ canDelete: true, id: channel.id }),
      ]);
      expect((await member.detail(channel.id)).channel.canDelete).toBe(true);
      await member.rename(channel.id, 'Growth');
      expect((await member.detail(channel.id)).channel.title).toBe('Growth');

      // The Channel's own roster is untouched: the role comes from the workspace.
      const [row] = await db
        .select({ role: channelMembers.role })
        .from(channelMembers)
        .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.userId, joinerId)));
      expect(row.role).toBe('member');
    },
  );

  it('keeps a plain workspace member a plain Channel member', async () => {
    const { channel, member } = await joinAsMember();

    expect((await member.detail(channel.id)).channel.canDelete).toBe(false);
    await expect(member.rename(channel.id, 'Growth')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('stops counting a workspace admin once they leave the workspace', async () => {
    await setWorkspaceRole('admin');
    const { channel, member } = await joinAsMember();
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, fixture.memberId));

    expect((await member.detail(channel.id)).channel.canDelete).toBe(false);
    await expect(member.rename(channel.id, 'Growth')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('gives a workspace admin nothing in a Channel they are not in', async () => {
    await setWorkspaceRole('admin');
    const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const { channel } = await owner.create({ title: 'Private' });
    const admin = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);

    expect(await admin.list()).toEqual([]);
    await expect(admin.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
