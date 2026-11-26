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
    'quotes a human without dispatch when mentioning no one (%s)',
    async (routing) => {
      const { asOwner, channel, input, root } = await setup();
      const message = await asOwner.send(channel.id, { ...input, replyToId: root.id, routing });
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

  it.each(['decision', 'fallback'] as const)(
    'dispatches the Agents @mentioned in a human quote, in the same feed (%s)',
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
        routingStatus: 'directed',
        routingReason: 'Mentioned',
        recipientMemberIds: [author.id],
      });
      expect(await jobsOf(db, message.id)).toMatchObject([{ memberId: author.id }]);
      expect(await threads(channel.id)).toEqual([]);
    },
  );

  it('does not invoke the paired Agent when replying to a human', async () => {
    const repo = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await repo.create({ title: 'Pair' });
    await fixture.addAgent(channel.id, 'Only Agent');
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
    });
    expect(message.routingStatus).toBe('skipped');
    expect(await jobsOf(db, message.id)).toEqual([]);
    expect(await threads(channel.id)).toEqual([]);
  });

  it('asks the quoted Agent in the same feed and includes its answer in the claimed input', async () => {
    const { asOwner, author, channel, executions, input } = await setup();
    const message = await asOwner.send(channel.id, input);
    expect(message).toMatchObject({
      replyToId: input.replyToId,
      threadId: null,
      routingStatus: 'directed',
      routingReason: 'Reply to Agent',
      recipientMemberIds: [author.id],
    });
    expect(await threads(channel.id)).toEqual([]);
    const [job] = await jobsOf(db, message.id);
    expect(job).toMatchObject({ memberId: author.id, threadId: null });
    await executions.claim(channel.id, job.id, lease);
    const context = await executions.input(channel.id, job.id);
    expect(context.map((entry) => entry.id)).toEqual([input.replyToId, message.id]);
    expect(context[1].replyToId).toBe(input.replyToId);
    const detail = await asOwner.detail(channel.id, { limit: 1 });
    expect(detail.messages[0]).toMatchObject({
      id: message.id,
      replyTo: { id: input.replyToId, author: { type: 'agent' } },
    });
  });

  it('asks only the @mentioned members when quoting an Agent', async () => {
    const { asOwner, author, channel, input, member, other } = await setup();
    const handOff = await asOwner.send(channel.id, { ...input, mentions: [other.id] });
    expect(handOff).toMatchObject({
      threadId: null,
      routingStatus: 'directed',
      routingReason: 'Mentioned',
      recipientMemberIds: [other.id],
    });
    expect(await jobsOf(db, handOff.id)).toMatchObject([{ memberId: other.id }]);
    const both = await asOwner.send(channel.id, {
      ...input,
      mentions: [other.id, author.id, other.id],
      requestKey: 'both',
    });
    expect(new Set(both.recipientMemberIds)).toEqual(new Set([author.id, other.id]));
    const person = await asOwner.send(channel.id, {
      ...input,
      mentions: [member.id],
      requestKey: 'person',
    });
    expect(person.recipientMemberIds).toEqual([]);
    expect(await jobsOf(db, person.id)).toEqual([]);
    expect(await threads(channel.id)).toEqual([]);
  });

  it('returns the original message for a retried reply', async () => {
    const { asOwner, author, channel, input } = await setup();
    const [first, retry] = await Promise.all([
      asOwner.send(channel.id, input),
      asOwner.send(channel.id, input),
    ]);
    expect(retry.id).toBe(first.id);
    expect(await jobsOf(db, first.id)).toMatchObject([{ memberId: author.id }]);
    expect(await threads(channel.id)).toEqual([]);
  });

  it('replies to an Agent within the current thread without nesting', async () => {
    const { asOwner, author, channel, input, other, publish, root } = await setup();
    const first = await asOwner.send(channel.id, {
      content: 'Let us discuss',
      mentions: [author.id],
      requestKey: 'branch',
      rootMessageId: root.id,
      routing: 'fallback',
    });
    const answerId = await publish(first.id, 'Three works');
    const quoted = await asOwner.send(channel.id, {
      ...input,
      replyToId: answerId,
      threadId: first.threadId,
      requestKey: 'in-thread',
    });
    expect(quoted.threadId).toBe(first.threadId);
    expect(quoted.recipientMemberIds).toEqual([author.id]);
    const handOff = await asOwner.send(channel.id, {
      ...input,
      replyToId: answerId,
      threadId: first.threadId,
      mentions: [other.id],
      requestKey: 'hand-off',
    });
    expect(handOff.threadId).toBe(first.threadId);
    expect(handOff.recipientMemberIds).toEqual([other.id]);
    const [thread] = await threads(channel.id);
    expect(new Set(thread.followerMemberIds)).toEqual(new Set([author.id, other.id]));
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

  it('rejects a removed Agent and a reply in an archived thread without dispatch', async () => {
    const { asOwner, author, channel, input, root } = await setup();
    await db.update(channelMembers).set({ status: 'left' }).where(eq(channelMembers.id, author.id));
    await expect(asOwner.send(channel.id, input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await threads(channel.id)).toEqual([]);
    await db
      .update(channelMembers)
      .set({ status: 'active' })
      .where(eq(channelMembers.id, author.id));
    const first = await asOwner.send(channel.id, {
      content: 'Branch',
      requestKey: 'branch',
      rootMessageId: root.id,
      routing: 'fallback',
    });
    await db
      .update(channelThreads)
      .set({ status: 'archived' })
      .where(eq(channelThreads.id, first.threadId!));
    await expect(
      asOwner.send(channel.id, {
        ...input,
        replyToId: first.id,
        requestKey: 'archived',
        threadId: first.threadId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a changed quote with the same retry key', async () => {
    const { asOwner, channel, input, root } = await setup();
    await asOwner.send(channel.id, { ...input, replyToId: root.id });
    await expect(asOwner.send(channel.id, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await threads(channel.id)).toEqual([]);
  });
});
