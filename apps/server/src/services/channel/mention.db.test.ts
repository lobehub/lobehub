// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelRepository } from '@/database/repositories/channel';
import { createChannelFixture } from '@/database/repositories/channel/__tests__/testUtils';
import { workspaceMembers } from '@/database/schemas';

import { notifyChannelMentions } from './mention';

const { after, notifyChannelMention } = vi.hoisted(() => ({
  after: vi.fn(),
  notifyChannelMention: vi.fn(),
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after }));
vi.mock('@/business/server/channel-mention/notifyActivity', () => ({ notifyChannelMention }));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-mention-notify');
beforeEach(async () => {
  vi.resetAllMocks();
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: fixture.ownerId, workspaceId: fixture.workspaceId },
    { userId: fixture.memberId, workspaceId: fixture.workspaceId },
  ]);
});
afterEach(fixture.cleanup);

/** The owner mentions themself and the member in a workspace Channel, then the ping runs. */
const mentionMember = async () => {
  const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await owner.create({ title: 'People' });
  const member = await owner.addUser(channel.id, fixture.memberId);
  const ownerMember = (await owner.detail(channel.id)).members.find(
    (item) => item.userId === fixture.ownerId,
  );
  const message = await owner.send(channel.id, {
    content: '@Olivia @mia please review',
    mentions: [ownerMember!.id, member.id],
    requestKey: 'mention',
    routing: 'fallback',
  });
  notifyChannelMentions(db, { userId: fixture.ownerId, workspaceId: fixture.workspaceId }, message);
  await after.mock.calls[0][0]();
  return { channel, message };
};

describe('notifyChannelMentions against the database', () => {
  it('pings the mentioned workspace member, never the sender', async () => {
    const { channel, message } = await mentionMember();

    expect(notifyChannelMention).toHaveBeenCalledWith({
      actorUserId: fixture.ownerId,
      channelId: channel.id,
      messageId: message.id,
      recipientUserIds: [fixture.memberId],
      workspaceId: fixture.workspaceId,
    });
  });

  it('skips a person who left the workspace but still has a Channel member row', async () => {
    const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const { channel } = await owner.create({ title: 'People' });
    const member = await owner.addUser(channel.id, fixture.memberId);
    // Leaving the workspace soft-deletes its membership and keeps the Channel row active.
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, fixture.workspaceId),
          eq(workspaceMembers.userId, fixture.memberId),
        ),
      );
    const message = await owner.send(channel.id, {
      content: '@mia are you still here?',
      mentions: [member.id],
      requestKey: 'departed',
      routing: 'fallback',
    });
    notifyChannelMentions(
      db,
      { userId: fixture.ownerId, workspaceId: fixture.workspaceId },
      message,
    );
    await after.mock.calls[0][0]();

    expect(notifyChannelMention).not.toHaveBeenCalled();
  });
});
