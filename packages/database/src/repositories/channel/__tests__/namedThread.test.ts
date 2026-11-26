// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMessages, channelThreads } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { noChannelContacts } from '../contacts';
import { createNamedThread, type NamedThreadInput } from '../namedThread';
import { createChannelFixture, jobsOf } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-named-thread');

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

type Repository = Awaited<ReturnType<typeof fixture.createTeamChannel>>['asMember'];
const named = (repository: Repository, channelId: string, input: NamedThreadInput) =>
  repository.write(
    channelId,
    (tx, access) => createNamedThread(tx, access, input, noChannelContacts),
    { joinOpen: true },
  );

describe('createNamedThread', () => {
  it('posts the name as a root that wakes no Agent and opens a Thread the person follows', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');

    const thread = await named(asMember, channel.id, {
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

    const first = await named(asMember, channel.id, input);
    const second = await named(asMember, channel.id, input);

    expect(second.id).toBe(first.id);
    expect(
      await db.select().from(channelThreads).where(eq(channelThreads.channelId, channel.id)),
    ).toHaveLength(1);
  });
});
