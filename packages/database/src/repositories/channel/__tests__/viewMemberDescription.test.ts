// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers } from '../../../schemas';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-view-description');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel member descriptions', () => {
  it('falls back to the Agent description and prefers a Channel-specific one', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');
    const member = (await asOwner.detail(channel.id)).members.find((item) => item.agentId)!;
    await db
      .update(agents)
      .set({ description: 'Owns parsers' })
      .where(eq(agents.id, member.agentId!));

    const fallback = (await asOwner.detail(channel.id)).members.find((m) => m.id === member.id);
    expect(fallback?.description).toBe('Owns parsers');

    await db
      .update(channelMembers)
      .set({ description: 'Reviews this release' })
      .where(eq(channelMembers.id, member.id));
    const own = (await asOwner.detail(channel.id)).members.find((m) => m.id === member.id);
    expect(own?.description).toBe('Reviews this release');
  });
});
