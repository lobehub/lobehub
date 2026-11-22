// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { setNotificationsMuted } from '../notificationMute';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-notification-mute');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const metadataOf = async (memberId: string) => {
  const [row] = await db
    .select({ metadata: channelMembers.metadata })
    .from(channelMembers)
    .where(eq(channelMembers.id, memberId));
  return row.metadata;
};

describe('Channel notification mute', () => {
  it("mutes the caller's own notifications only, in list and detail", async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();

    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ id: channel.id, notificationsMuted: false }),
    ]);

    await expect(asOwner.setNotificationsMuted(channel.id, true)).resolves.toBe(true);
    // Setting it again is a no-op.
    await expect(asOwner.setNotificationsMuted(channel.id, true)).resolves.toBe(true);

    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ id: channel.id, notificationsMuted: true }),
    ]);
    expect((await asOwner.detail(channel.id)).channel.notificationsMuted).toBe(true);
    // Another member's own list and detail are untouched.
    expect(await asMember.list()).toEqual([
      expect.objectContaining({ id: channel.id, notificationsMuted: false }),
    ]);
    expect((await asMember.detail(channel.id)).channel.notificationsMuted).toBe(false);

    await expect(asOwner.setNotificationsMuted(channel.id, false)).resolves.toBe(false);
    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ id: channel.id, notificationsMuted: false }),
    ]);
  });

  it('keeps the other metadata keys of the member row', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    await db
      .update(channelMembers)
      .set({ metadata: { invitedBy: 'someone' } })
      .where(eq(channelMembers.id, member.id));

    await asMember.setNotificationsMuted(channel.id, true);
    expect(await metadataOf(member.id)).toEqual({ invitedBy: 'someone', notificationsMuted: true });

    await asMember.setNotificationsMuted(channel.id, false);
    expect(await metadataOf(member.id)).toEqual({ invitedBy: 'someone' });
  });

  it('does not mute an Agent member, which keeps replying', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Helper');

    await asOwner.setNotificationsMuted(channel.id, true);

    const [row] = await db.select().from(channelMembers).where(eq(channelMembers.id, agent.id));
    expect(row.config?.muted).toBeUndefined();
    expect(row.metadata).not.toHaveProperty('notificationsMuted');
  });

  it("fails closed instead of muting a row that is not the caller's own", async () => {
    const { member, owner } = await fixture.createTeamChannel();

    // A caller holding somebody else's member id cannot rewrite that row: the predicate carries
    // the caller's own user id, so no row matches and the helper refuses rather than reporting a
    // mute it never wrote.
    await expect(
      db.transaction((tx) =>
        setNotificationsMuted(tx, { memberId: owner.id, userId: member.userId! }, true),
      ),
    ).rejects.toThrow('Channel member not found for this person');

    expect(await metadataOf(owner.id)).toEqual({});
    expect(await metadataOf(member.id)).toEqual({});
  });

  it('works in an archived conversation and refuses a non-member', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await asOwner.archive(channel.id);
    await expect(asOwner.setNotificationsMuted(channel.id, true)).resolves.toBe(true);

    const stranger = new ChannelRepository(db, 'channel-notification-mute-stranger');
    await expect(stranger.setNotificationsMuted(channel.id, true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
