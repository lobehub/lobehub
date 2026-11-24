// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMessages, channelThreads } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { createChannelFixture, jobsOf } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-named-thread');

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('ChannelRepository.createNamedThread', () => {
  it('posts the name as a root that wakes no Agent and opens a Thread the person follows', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');

    const thread = await asMember.createNamedThread(channel.id, {
      requestKey: 'named',
      title: 'Parts library',
    });

    const [root] = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.id, thread.rootMessageId));
    expect(root).toMatchObject({ content: 'Parts library', threadId: null });
    expect(await jobsOf(db, root.id)).toEqual([]);
    expect(thread.followerMemberIds).toEqual([member.id]);
  });

  it('returns the same Thread when retried with the same key', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const input = { requestKey: 'retry', title: 'Once' };

    const first = await asMember.createNamedThread(channel.id, input);
    const second = await asMember.createNamedThread(channel.id, input);

    expect(second.id).toBe(first.id);
    expect(
      await db.select().from(channelThreads).where(eq(channelThreads.channelId, channel.id)),
    ).toHaveLength(1);
  });
});
