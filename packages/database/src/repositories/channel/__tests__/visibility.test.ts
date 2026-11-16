// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelAudit, channelMembers, channels, workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-visibility');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(fixture.cleanup);

const create = async (title = 'Announcements') => {
  const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await owner.create({ title });
  const outsider = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
  return { channel, outsider, owner };
};

describe('Channel visibility', () => {
  it('starts private: workspace members outside it can neither find nor join it', async () => {
    const { channel, outsider } = await create();
    expect(channel.visibility).toBe('private');
    expect(await outsider.listJoinable()).toEqual([]);
    await expect(outsider.join(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(outsider.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets an admin publish it, then any workspace member find and join it as a member', async () => {
    const { channel, outsider, owner } = await create();
    expect(await owner.updateVisibility(channel.id, 'public')).toMatchObject({
      visibility: 'public',
    });
    await owner.send(channel.id, { content: 'Hello', requestKey: 'hello', routing: 'fallback' });

    expect(await outsider.listJoinable()).toEqual([
      expect.objectContaining({ id: channel.id, memberCount: 1, title: 'Announcements' }),
    ]);
    expect(await outsider.listJoinable('announ')).toHaveLength(1);
    expect(await outsider.listJoinable('nothing')).toEqual([]);
    // Joining still goes through membership: reading before it stays closed.
    await expect(outsider.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const { member } = await outsider.join(channel.id);
    expect(member).toMatchObject({ role: 'member', status: 'active', userId: fixture.memberId });
    expect((await outsider.join(channel.id)).member.id).toBe(member.id);
    expect(await outsider.listJoinable()).toEqual([]);
    // The history is readable, and not counted as unread.
    expect((await outsider.detail(channel.id)).messages).toHaveLength(1);
    expect(await outsider.list()).toEqual([
      expect.objectContaining({ canDelete: false, id: channel.id, unreadCount: 0 }),
    ]);
    // A joiner is a plain member, so cannot change the visibility back.
    await expect(outsider.updateVisibility(channel.id, 'private')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const events = await db
      .select({ event: channelAudit.event })
      .from(channelAudit)
      .where(eq(channelAudit.channelId, channel.id));
    expect(events.map(({ event }) => event)).toEqual(
      expect.arrayContaining(['visibility_changed', 'member_joined']),
    );
  });

  it('keeps members when it goes private again, and lets a former member rejoin while public', async () => {
    const { channel, outsider, owner } = await create();
    await owner.updateVisibility(channel.id, 'public');
    const { member } = await outsider.join(channel.id);
    await db.update(channelMembers).set({ status: 'left' }).where(eq(channelMembers.id, member.id));
    expect((await outsider.join(channel.id)).member).toMatchObject({
      id: member.id,
      status: 'active',
    });

    await owner.updateVisibility(channel.id, 'private');
    expect(await outsider.list()).toEqual([expect.objectContaining({ id: channel.id })]);
    await db.update(channelMembers).set({ status: 'left' }).where(eq(channelMembers.id, member.id));
    await expect(outsider.join(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('hides archived and trashed public channels, and rejects people outside the workspace', async () => {
    const { channel, outsider, owner } = await create();
    await owner.updateVisibility(channel.id, 'public');
    await owner.archive(channel.id);
    expect(await outsider.listJoinable()).toEqual([]);
    await expect(outsider.join(channel.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await owner.unarchive(channel.id);
    await owner.remove(channel.id);
    expect(await outsider.listJoinable()).toEqual([]);
    await expect(outsider.join(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const other = await create('Other');
    await owner.updateVisibility(other.channel.id, 'public');
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, fixture.workspaceId),
          eq(workspaceMembers.userId, fixture.memberId),
        ),
      );
    await expect(outsider.listJoinable()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(outsider.join(other.channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never makes a direct conversation or a personal channel public', async () => {
    const personal = new ChannelRepository(db, fixture.ownerId, null);
    const { channel } = await personal.create({ title: 'Mine' });
    await expect(personal.updateVisibility(channel.id, 'public')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await personal.listJoinable()).toEqual([]);
    const [stored] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(stored.visibility).toBe('private');
  });
});
