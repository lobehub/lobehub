// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-pin');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel pin', () => {
  it('pins a conversation for the caller only and keeps the first pin time', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();

    const pinnedAt = await asOwner.setPinned(channel.id, true);
    expect(pinnedAt).toBeInstanceOf(Date);
    // Pinning again keeps its place in the pinned order.
    await expect(asOwner.setPinned(channel.id, true)).resolves.toEqual(pinnedAt);

    expect(await asOwner.list()).toEqual([expect.objectContaining({ id: channel.id, pinnedAt })]);
    // A workspace member's own list is untouched by someone else's pin.
    expect(await asMember.list()).toEqual([
      expect.objectContaining({ id: channel.id, pinnedAt: null }),
    ]);

    await expect(asOwner.setPinned(channel.id, false)).resolves.toBeNull();
    expect(await asOwner.list()).toEqual([
      expect.objectContaining({ id: channel.id, pinnedAt: null }),
    ]);
  });

  it('pins an archived conversation, which stays readable', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await asOwner.archive(channel.id);

    await expect(asOwner.setPinned(channel.id, true)).resolves.toBeInstanceOf(Date);
  });
});
