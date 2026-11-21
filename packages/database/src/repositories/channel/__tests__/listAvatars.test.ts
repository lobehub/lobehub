// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers } from '../../../schemas';
import { CHANNEL_AVATAR_MEMBERS } from '../avatars';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-list-avatars');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel list avatars', () => {
  // Three faces left most of a large group out; the grid holds the caller plus eight more.
  it('pictures the earliest other active members, capped, for each caller', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const first = await fixture.addAgent(channel.id, 'First');
    const removed = await fixture.addAgent(channel.id, 'Removed');
    const later = [];
    for (let index = 0; index < 7; index++)
      later.push(await fixture.addAgent(channel.id, `Agent ${index}`));
    await db
      .update(channelMembers)
      .set({ status: 'removed' })
      .where(eq(channelMembers.id, removed.id));

    const agents = [first, ...later.slice(0, 6)].map((agent) => ({
      actorType: 'agent',
      id: agent.agentId,
    }));
    const [ownerRow] = await asOwner.list();
    expect(ownerRow.memberAvatars).toHaveLength(CHANNEL_AVATAR_MEMBERS);
    expect(ownerRow.memberAvatars).toMatchObject([
      { actorType: 'user', id: fixture.memberId },
      { actorType: 'agent', id: first.agentId, name: 'First' },
      ...agents.slice(1),
    ]);

    const [memberRow] = await asMember.list();
    expect(memberRow.memberAvatars).toMatchObject([
      { actorType: 'user', id: fixture.ownerId },
      ...agents,
    ]);
  });

  it('pictures no one in a Channel the caller is alone in', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await db.delete(channelMembers).where(eq(channelMembers.userId, fixture.memberId));

    const rows = await asOwner.list();
    expect(rows.find((row) => row.id === channel.id)?.memberAvatars).toEqual([]);
  });

  // The avatars stop at the first few members; an Agent's page must still find every Channel
  // it takes part in, and not ones it has left.
  it('lists every active Agent member beyond the avatar cap', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agents = [];
    for (let index = 0; index < CHANNEL_AVATAR_MEMBERS + 1; index++)
      agents.push(await fixture.addAgent(channel.id, `Agent ${index}`));
    const removed = await fixture.addAgent(channel.id, 'Removed');
    await db
      .update(channelMembers)
      .set({ status: 'removed' })
      .where(eq(channelMembers.id, removed.id));

    const row = (await asOwner.list()).find((item) => item.id === channel.id);
    expect(row?.agentIds).toEqual(agents.map((agent) => agent.agentId));
    expect(row?.agentIds).not.toContain(removed.agentId);
  });
});
