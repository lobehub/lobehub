// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers } from '../../../schemas';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-list-avatars');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel list avatars', () => {
  it('pictures the earliest other active members, capped, for each caller', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const first = await fixture.addAgent(channel.id, 'First');
    const removed = await fixture.addAgent(channel.id, 'Removed');
    const second = await fixture.addAgent(channel.id, 'Second');
    await fixture.addAgent(channel.id, 'Third');
    await db
      .update(channelMembers)
      .set({ status: 'removed' })
      .where(eq(channelMembers.id, removed.id));

    const [ownerRow] = await asOwner.list();
    expect(ownerRow.memberAvatars).toMatchObject([
      { actorType: 'user', id: fixture.memberId },
      { actorType: 'agent', id: first.agentId, name: 'First' },
      { actorType: 'agent', id: second.agentId, name: 'Second' },
    ]);

    const [memberRow] = await asMember.list();
    expect(memberRow.memberAvatars).toMatchObject([
      { actorType: 'user', id: fixture.ownerId },
      { actorType: 'agent', id: first.agentId },
      { actorType: 'agent', id: second.agentId },
    ]);
  });

  it('pictures no one in a Channel the caller is alone in', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await db.delete(channelMembers).where(eq(channelMembers.userId, fixture.memberId));

    const rows = await asOwner.list();
    expect(rows.find((row) => row.id === channel.id)?.memberAvatars).toEqual([]);
  });
});
