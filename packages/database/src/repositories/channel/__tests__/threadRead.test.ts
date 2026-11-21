// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers } from '../../../schemas';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-thread-read');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** A team channel with one Thread the owner replied in, and a second, empty one. */
const setup = async () => {
  const team = await fixture.createTeamChannel();
  const { asOwner, channel } = team;
  let key = 0;
  const say = (
    repo: typeof asOwner,
    content: string,
    options: { rootMessageId?: string; threadId?: string } = {},
  ) =>
    repo.send(channel.id, {
      content,
      requestKey: `read-${++key}`,
      routing: 'fallback',
      ...options,
    });
  const root = await say(asOwner, 'Release plan');
  const thread = await asOwner.createThread(channel.id, { rootMessageId: root.id });
  const reply = await say(asOwner, 'Cut on Friday', { threadId: thread.id });
  const quietRoot = await say(asOwner, 'Nobody answers this');
  const quiet = await asOwner.createThread(channel.id, { rootMessageId: quietRoot.id });
  return { ...team, quiet, quietRoot, reply, root, say, thread };
};

const threadOf = async (repo: { detail: (id: string) => Promise<any> }, channelId: string) => {
  const view = await repo.detail(channelId);
  return (id: string) => view.threads.find((thread: { id: string }) => thread.id === id);
};

describe('ChannelRepository.markThreadRead', () => {
  it('keeps the highest position per Thread, bounded by the channel sequence', async () => {
    const { asMember, channel, member, quiet, reply, say, thread } = await setup();
    await db
      .update(channelMembers)
      .set({ metadata: { note: 'kept' } })
      .where(eq(channelMembers.id, member.id));
    const chatter = await say(asMember, 'Main timeline chatter');

    expect(await asMember.markThreadRead(channel.id, thread.id, reply.sequence)).toBe(
      reply.sequence,
    );
    expect(await asMember.markThreadRead(channel.id, thread.id, 0)).toBe(reply.sequence);
    expect(await asMember.markThreadRead(channel.id, thread.id, 10_000)).toBe(chatter.sequence);
    expect(await asMember.markThreadRead(channel.id, quiet.id, 1)).toBe(1);

    const [row] = await db
      .select({ metadata: channelMembers.metadata })
      .from(channelMembers)
      .where(eq(channelMembers.id, member.id));
    expect(row.metadata).toEqual({
      note: 'kept',
      threadReadSequences: { [quiet.id]: 1, [thread.id]: chatter.sequence },
    });
    // The main timeline position is its own.
    expect(await asMember.markRead(channel.id, 0)).toBe(chatter.sequence);
  });

  it('rejects a Thread of another channel or one in the trash', async () => {
    const { asMember, asOwner, channel, thread } = await setup();
    const other = await fixture.createTeamChannel('Other');
    const otherRoot = await other.asOwner.send(other.channel.id, {
      content: 'Elsewhere',
      requestKey: 'elsewhere',
      routing: 'fallback',
    });
    const foreign = await other.asOwner.createThread(other.channel.id, {
      rootMessageId: otherRoot.id,
    });

    await expect(asMember.markThreadRead(channel.id, foreign.id, 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await asOwner.removeThread(channel.id, thread.id);
    await expect(asMember.markThreadRead(channel.id, thread.id, 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('ChannelRepository.detail thread read positions', () => {
  it('reports every Thread’s newest sequence and the caller’s own read position', async () => {
    const { asMember, asOwner, channel, quiet, quietRoot, reply, say, thread } = await setup();

    // The owner wrote the reply, so their own Thread is read; the member has not opened it.
    let owner = await threadOf(asOwner, channel.id);
    expect(owner(thread.id)).toMatchObject({
      lastReadSequence: reply.sequence,
      lastSequence: reply.sequence,
    });
    // A Thread without replies ends at its root.
    expect(owner(quiet.id)).toMatchObject({
      lastReadSequence: 0,
      lastSequence: quietRoot.sequence,
    });
    let member = await threadOf(asMember, channel.id);
    expect(member(thread.id)).toMatchObject({ lastReadSequence: 0, lastSequence: reply.sequence });

    await asMember.markThreadRead(channel.id, thread.id, reply.sequence);
    const newer = await say(asOwner, 'Moved to Monday', { threadId: thread.id });
    member = await threadOf(asMember, channel.id);
    expect(member(thread.id)).toMatchObject({
      lastReadSequence: reply.sequence,
      lastSequence: newer.sequence,
    });

    // A deleted reply no longer counts as news.
    await asOwner.deleteMessage(channel.id, newer.id);
    owner = await threadOf(asOwner, channel.id);
    expect(owner(thread.id)).toMatchObject({ lastSequence: reply.sequence });

    // Members never see each other's positions.
    const view = await asOwner.detail(channel.id);
    for (const entry of view.members) expect(entry).not.toHaveProperty('threadReadSequences');
  });

  it('reports positions even for Threads whose root is off the loaded page', async () => {
    const { asMember, channel, reply, thread } = await setup();
    await asMember.markThreadRead(channel.id, thread.id, reply.sequence);
    const view = await asMember.detail(channel.id, { limit: 1 });
    expect(view.messages.some((message) => message.id === thread.rootMessageId)).toBe(false);
    expect(view.threads.find((entry) => entry.id === thread.id)).toMatchObject({
      lastReadSequence: reply.sequence,
      lastSequence: reply.sequence,
    });
  });
});
