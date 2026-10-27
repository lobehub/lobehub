// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers, channelThreads } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-thread-send');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async () => {
  const team = await fixture.createTeamChannel();
  const author = await fixture.addAgent(team.channel.id, 'Author');
  const other = await fixture.addAgent(team.channel.id, 'Other');
  const root = await team.asOwner.send(team.channel.id, {
    content: 'Hello',
    mentions: [author.id],
    requestKey: 'root',
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, root.id);
  const executions = new ChannelExecutionRepository(db);
  await executions.claim(team.channel.id, job.id, lease);
  await executions.accepted(team.channel.id, job.id);
  await executions.saveDraft(team.channel.id, job.id, 'Hello from Author');
  const replyId = await executions.publish(team.channel.id, job.id);
  await executions.releaseWriter(team.channel.id, job.id);
  const input = {
    content: 'Continue here',
    requestKey: 'first-thread-message',
    rootMessageId: replyId,
    routing: 'fallback' as const,
  };
  return { ...team, author, input, other, root };
};
const threads = (channelId: string) =>
  db.select().from(channelThreads).where(eq(channelThreads.channelId, channelId));

describe('First thread reply transaction', () => {
  it('creates the thread and first reply together, including the root Agent as a follower', async () => {
    const { asOwner, author, channel, input } = await setup();
    expect(await threads(channel.id)).toEqual([]);
    const message = await asOwner.send(channel.id, input);
    const [thread] = await threads(channel.id);
    expect(thread).toMatchObject({
      rootMessageId: input.rootMessageId,
      followerMemberIds: [author.id],
    });
    expect(message.threadId).toBe(thread.id);
    expect(
      (await asOwner.detail(channel.id, { threadId: thread.id })).messages.map((m) => m.id),
    ).toEqual([message.id]);
    expect(await jobsOf(db, message.id)).toEqual([
      expect.objectContaining({ memberId: author.id, threadId: thread.id }),
    ]);
  });

  it('rolls back the new thread when message validation or attachment access fails', async () => {
    const { asOwner, channel, input } = await setup();
    for (const patch of [{ content: '' }, { fileIds: ['missing-file'] }]) {
      await expect(asOwner.send(channel.id, { ...input, ...patch })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(await threads(channel.id)).toEqual([]);
    }
  });

  it('reuses one thread and one message across retries, and reuses the thread for another send', async () => {
    const { asOwner, channel, input } = await setup();
    const messages = await Promise.all([
      asOwner.send(channel.id, input),
      asOwner.send(channel.id, input),
    ]);
    expect(messages[0].id).toBe(messages[1].id);
    expect(messages[0].threadId).toBeTruthy();
    const next = await asOwner.send(channel.id, {
      ...input,
      content: 'Second',
      requestKey: 'second',
    });
    expect(next.threadId).toBe(messages[0].threadId);
    expect(await threads(channel.id)).toHaveLength(1);
    expect(await jobsOf(db, messages[0].id)).toHaveLength(1);
    const detail = await asOwner.detail(channel.id, { threadId: next.threadId });
    expect(detail.messages.map((m) => m.id)).toEqual([messages[0].id, next.id]);
  });

  it('rejects conflicting destinations and roots from other channels without leaving an empty thread', async () => {
    const { asOwner, channel, input } = await setup();
    await expect(
      asOwner.send(channel.id, { ...input, threadId: 'cht_not-a-thread' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await threads(channel.id)).toEqual([]);
    const foreign = await fixture.createTeamChannel('Foreign');
    await expect(foreign.asOwner.send(foreign.channel.id, input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await threads(foreign.channel.id)).toEqual([]);
    await expect(
      new ChannelRepository(db, fixture.ownerId).send(channel.id, input),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await threads(channel.id)).toEqual([]);
  });

  it('does not create a new thread when a request key is already used for another destination', async () => {
    const { asOwner, channel, input } = await setup();
    await asOwner.send(channel.id, {
      content: input.content,
      requestKey: input.requestKey,
      routing: 'fallback',
    });
    await expect(asOwner.send(channel.id, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await threads(channel.id)).toEqual([]);
  });

  it('inherits active recipients of a human root without enrolling unrelated Agents', async () => {
    const { asOwner, author, channel, input, root } = await setup();
    const message = await asOwner.send(channel.id, { ...input, rootMessageId: root.id });
    expect((await threads(channel.id))[0].followerMemberIds).toEqual([author.id]);
    expect(message.recipientMemberIds).toEqual([author.id]);
  });

  it('does not restore an inactive recipient when deriving followers from the root', async () => {
    const { asOwner, author, channel, input, root } = await setup();
    await db.update(channelMembers).set({ status: 'left' }).where(eq(channelMembers.id, author.id));
    const message = await asOwner.send(channel.id, { ...input, rootMessageId: root.id });
    expect((await threads(channel.id))[0].followerMemberIds).toEqual([]);
    expect(await jobsOf(db, message.id)).toEqual([]);
  });
});
