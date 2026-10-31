// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers, channelThreads } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reply');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async () => {
  const team = await fixture.createTeamChannel();
  const author = await fixture.addAgent(team.channel.id, 'Author');
  const other = await fixture.addAgent(team.channel.id, 'Other');
  await fixture.addAgent(team.channel.id, 'Unrelated');
  const root = await team.asOwner.send(team.channel.id, {
    content: 'When should we meet?',
    mentions: [author.id],
    requestKey: 'root',
    routing: 'fallback',
  });
  const executions = new ChannelExecutionRepository(db);
  const publish = async (messageId: string, content: string) => {
    const [job] = await jobsOf(db, messageId);
    expect(await executions.claim(team.channel.id, job.id, lease)).toBeTruthy();
    await executions.accepted(team.channel.id, job.id);
    await executions.saveDraft(team.channel.id, job.id, content);
    const replyId = await executions.publish(team.channel.id, job.id);
    await executions.releaseWriter(team.channel.id, job.id);
    return replyId;
  };
  const replyId = await publish(root.id, 'How about two o’clock?');
  const input = {
    content: 'Could we make it three?',
    replyToId: replyId,
    requestKey: 'reply',
    routing: 'decision' as const,
  };
  return { ...team, author, executions, input, other, publish, root };
};
const threads = (channelId: string) =>
  db.select().from(channelThreads).where(eq(channelThreads.channelId, channelId));

describe('Channel replies', () => {
  it.each(['decision', 'fallback'] as const)(
    'quotes a human without dispatch even when @mentioning an Agent (%s)',
    async (routing) => {
      const { asOwner, author, channel, input, root } = await setup();
      const message = await asOwner.send(channel.id, {
        ...input,
        mentions: [author.id],
        replyToId: root.id,
        routing,
      });
      expect(message).toMatchObject({
        replyToId: root.id,
        threadId: null,
        routingStatus: 'skipped',
        recipientMemberIds: [],
      });
      expect(await jobsOf(db, message.id)).toEqual([]);
      expect(await threads(channel.id)).toEqual([]);
      const detail = await asOwner.detail(channel.id, { limit: 1 });
      expect(detail.messages[0].replyTo).toMatchObject({
        id: root.id,
        content: root.content,
        author: { type: 'user' },
      });
    },
  );

  it('does not invoke the paired Agent when replying to a human', async () => {
    const repo = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await repo.create({ title: 'Pair' });
    const author = await fixture.addAgent(channel.id, 'Only Agent');
    const root = await repo.send(channel.id, {
      content: 'Hi',
      requestKey: 'root',
      routing: 'fallback',
    });
    const message = await repo.send(channel.id, {
      content: 'A correction',
      requestKey: 'correction',
      routing: 'fallback',
      replyToId: root.id,
      mentions: [author.id],
    });
    expect(message.routingStatus).toBe('skipped');
    expect(await jobsOf(db, message.id)).toEqual([]);
    expect(await threads(channel.id)).toEqual([]);
  });

  it('creates a thread with only the replied-to Agent and includes its answer in the claimed input', async () => {
    const { asOwner, author, channel, executions, input } = await setup();
    const message = await asOwner.send(channel.id, input);
    const [thread] = await threads(channel.id);
    expect(thread).toMatchObject({
      rootMessageId: input.replyToId,
      followerMemberIds: [author.id],
    });
    expect(message).toMatchObject({
      threadId: thread.id,
      routingStatus: 'directed',
      recipientMemberIds: [author.id],
    });
    const [job] = await jobsOf(db, message.id);
    expect(job).toMatchObject({ memberId: author.id, threadId: thread.id });
    await executions.claim(channel.id, job.id, lease);
    const context = await executions.input(channel.id, job.id);
    expect(context.map((entry) => entry.id)).toEqual([input.replyToId, message.id]);
    expect(context[1].replyToId).toBe(input.replyToId);
    const detail = await asOwner.detail(channel.id, { threadId: thread.id });
    expect(detail.messages[0].replyTo).toMatchObject({
      id: input.replyToId,
      author: { type: 'agent' },
    });
    expect((await asOwner.detail(channel.id)).messages.map((entry) => entry.id)).not.toContain(
      message.id,
    );
  });

  it('unions explicit Agent mentions with the author and retains them for subsequent conversation', async () => {
    const { asOwner, author, channel, input, other } = await setup();
    const message = await asOwner.send(channel.id, {
      ...input,
      mentions: [other.id, author.id, other.id],
    });
    expect(new Set(message.recipientMemberIds)).toEqual(new Set([author.id, other.id]));
    expect(await jobsOf(db, message.id)).toHaveLength(2);
    const [thread] = await threads(channel.id);
    expect(new Set(thread.followerMemberIds)).toEqual(new Set([author.id, other.id]));
    const next = await asOwner.send(channel.id, {
      content: 'Continue',
      requestKey: 'next',
      routing: 'fallback',
      threadId: thread.id,
    });
    expect(new Set(next.recipientMemberIds)).toEqual(new Set([author.id, other.id]));
    const humanQuote = await asOwner.send(channel.id, {
      content: 'Just a note',
      mentions: [other.id],
      requestKey: 'note',
      routing: 'decision',
      replyToId: next.id,
      threadId: thread.id,
    });
    expect(humanQuote.threadId).toBe(thread.id);
    expect(await jobsOf(db, humanQuote.id)).toEqual([]);
    expect(await threads(channel.id)).toHaveLength(1);
  });

  it('reuses the thread and idempotent message without removing existing followers', async () => {
    const { asOwner, author, channel, input, other } = await setup();
    const firstInput = { ...input, mentions: [other.id] };
    const [first, retry] = await Promise.all([
      asOwner.send(channel.id, firstInput),
      asOwner.send(channel.id, firstInput),
    ]);
    expect(retry.id).toBe(first.id);
    expect(await jobsOf(db, first.id)).toHaveLength(2);
    const next = await asOwner.send(channel.id, { ...input, requestKey: 'again' });
    expect(next.threadId).toBe(first.threadId);
    expect(next.recipientMemberIds).toEqual([author.id]);
    const all = await threads(channel.id);
    expect(all).toHaveLength(1);
    expect(new Set(all[0].followerMemberIds)).toEqual(new Set([author.id, other.id]));
  });

  it('replies to an Agent within the current thread without nesting, adding only mentioned Agents', async () => {
    const { asOwner, author, channel, input, other, publish } = await setup();
    const first = await asOwner.send(channel.id, input);
    const answerId = await publish(first.id, 'Three works');
    const next = await asOwner.send(channel.id, {
      ...input,
      replyToId: answerId,
      threadId: first.threadId,
      mentions: [other.id],
      requestKey: 'in-thread',
    });
    expect(next.threadId).toBe(first.threadId);
    expect(new Set(next.recipientMemberIds)).toEqual(new Set([author.id, other.id]));
    expect(await threads(channel.id)).toHaveLength(1);
    await expect(
      asOwner.send(channel.id, { ...input, replyToId: answerId, requestKey: 'wrong-scope' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects foreign scope and invalid inputs atomically without empty threads', async () => {
    const { asOwner, channel, input } = await setup();
    const foreign = await fixture.createTeamChannel('Foreign');
    await expect(foreign.asOwner.send(foreign.channel.id, input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      new ChannelRepository(db, fixture.ownerId).send(channel.id, input),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const patch of [
      { rootMessageId: input.replyToId },
      { fileIds: ['missing-file'] },
      { replyToId: '00000000-0000-4000-8000-000000000000' },
    ]) {
      await expect(asOwner.send(channel.id, { ...input, ...patch })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(await threads(channel.id)).toEqual([]);
    }
    expect(await threads(foreign.channel.id)).toEqual([]);
  });

  it('rejects a removed Agent and an archived thread without dispatch', async () => {
    const { asOwner, author, channel, input } = await setup();
    await db.update(channelMembers).set({ status: 'left' }).where(eq(channelMembers.id, author.id));
    await expect(asOwner.send(channel.id, input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await threads(channel.id)).toEqual([]);
    await db
      .update(channelMembers)
      .set({ status: 'active' })
      .where(eq(channelMembers.id, author.id));
    const first = await asOwner.send(channel.id, input);
    await db
      .update(channelThreads)
      .set({ status: 'archived' })
      .where(eq(channelThreads.id, first.threadId!));
    await expect(
      asOwner.send(channel.id, { ...input, requestKey: 'archived' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a changed quote with the same retry key and rolls back thread creation', async () => {
    const { asOwner, channel, input, root } = await setup();
    await asOwner.send(channel.id, { ...input, replyToId: root.id });
    await expect(asOwner.send(channel.id, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await threads(channel.id)).toEqual([]);
  });
});
