// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelAudit, channelMembers, channelThreads, topics } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, deviceConfig, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-remove-thread');
const executions = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async () => {
  const team = await fixture.createTeamChannel();
  const root = await team.asOwner.send(team.channel.id, {
    content: 'Root',
    requestKey: 'root',
    routing: 'fallback',
  });
  const thread = await team.asOwner.createThread(team.channel.id, { rootMessageId: root.id });
  return { ...team, root, thread };
};

describe('Thread deletion', () => {
  it('hides only the selected branch, keeps its root, and allows a fresh branch without resurrecting replies', async () => {
    const { asOwner, channel, root, thread } = await setup();
    await asOwner.send(channel.id, {
      threadId: thread.id,
      content: 'Old reply',
      requestKey: 'reply',
      routing: 'fallback',
    });
    const root2 = await asOwner.send(channel.id, {
      content: 'Other root',
      requestKey: 'root2',
      routing: 'fallback',
    });
    const sibling = await asOwner.createThread(channel.id, { rootMessageId: root2.id });
    await asOwner.removeThread(channel.id, thread.id);
    await asOwner.removeThread(channel.id, thread.id);
    const main = await asOwner.detail(channel.id);
    expect(main.messages.map((m) => m.id)).toEqual([root.id, root2.id]);
    expect(main.threads.map((t) => t.id)).toEqual([sibling.id]);
    expect(await asOwner.list()).toHaveLength(1);
    await expect(asOwner.detail(channel.id, { threadId: thread.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      asOwner.send(channel.id, {
        threadId: thread.id,
        content: 'No',
        requestKey: 'late',
        routing: 'fallback',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const fresh = await asOwner.send(channel.id, {
      rootMessageId: root.id,
      content: 'New reply',
      requestKey: 'fresh',
      routing: 'fallback',
    });
    expect(fresh.threadId).not.toBe(thread.id);
    expect(
      (await asOwner.detail(channel.id, { threadId: fresh.threadId })).messages.map((m) => m.id),
    ).toEqual([fresh.id]);
    expect(
      (await db.select().from(channelAudit).where(eq(channelAudit.targetId, thread.id))).filter(
        (a) => a.event === 'thread_trashed',
      ),
    ).toHaveLength(1);
  });

  it('rechecks admin membership, identity, workspace and the thread/channel pair', async () => {
    const { asOwner, asMember, channel, member, thread } = await setup();
    await expect(asMember.removeThread(channel.id, thread.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      new ChannelRepository(db, fixture.ownerId).removeThread(channel.id, thread.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      new ChannelRepository(db, fixture.ownerId, 'wrong-workspace').removeThread(
        channel.id,
        thread.id,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = await fixture.createTeamChannel('Other');
    await expect(other.asOwner.removeThread(other.channel.id, thread.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await db.update(channelMembers).set({ role: 'admin' }).where(eq(channelMembers.id, member.id));
    await asMember.removeThread(channel.id, thread.id);
    await db.update(channelMembers).set({ role: 'member' }).where(eq(channelMembers.id, member.id));
    await expect(asMember.removeThread(channel.id, thread.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await db.update(channelMembers).set({ status: 'left' }).where(eq(channelMembers.id, member.id));
    await expect(asMember.removeThread(channel.id, thread.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await asOwner.removeThread(channel.id, thread.id);
  });

  it('allows a personal owner, not another personal user', async () => {
    const repo = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await repo.create({ title: 'Personal' });
    const root = await repo.send(channel.id, {
      content: 'Root',
      requestKey: 'root',
      routing: 'fallback',
    });
    const thread = await repo.createThread(channel.id, { rootMessageId: root.id });
    await expect(
      new ChannelRepository(db, fixture.memberId).removeThread(channel.id, thread.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await repo.removeThread(channel.id, thread.id);
    expect((await repo.detail(channel.id)).threads).toEqual([]);
  });

  it('fences late routing and publication, retaining directory locks until physical exit without stopping the main channel', async () => {
    const { asOwner, channel, root, thread } = await setup();
    const writer = await fixture.addAgent(channel.id, 'Writer', deviceConfig('/repo'));
    const other = await fixture.addAgent(channel.id, 'Other', deviceConfig('/other'));
    const send = (requestKey: string, threadId: string | null, memberId: string) =>
      asOwner.send(channel.id, {
        content: requestKey,
        requestKey,
        threadId,
        mentions: [memberId],
        routing: 'fallback',
      });
    const reply = await send('thread-running', thread.id, writer.id);
    const [running] = await jobsOf(db, reply.id);
    const claim = await executions.claim(channel.id, running.id, lease);
    await executions.accepted(channel.id, running.id);
    await executions.saveDraft(channel.id, running.id, 'Too late');
    const queuedMessage = await send('thread-queued', thread.id, writer.id);
    const [queued] = await jobsOf(db, queuedMessage.id);
    const mainMessage = await send('main-running', null, other.id);
    const [main] = await jobsOf(db, mainMessage.id);
    await executions.claim(channel.id, main.id, lease);
    await executions.accepted(channel.id, main.id);
    const pending = await asOwner.send(channel.id, {
      content: 'Route me',
      requestKey: 'pending',
      threadId: thread.id,
      routing: 'decision',
    });

    await asOwner.removeThread(channel.id, thread.id);
    expect(await jobById(db, running.id)).toMatchObject({
      status: 'cancelled',
      publicationRevoked: true,
      writerHeld: true,
    });
    expect(await jobById(db, queued.id)).toMatchObject({ status: 'cancelled', writerHeld: false });
    expect(await executions.claim(channel.id, queued.id, lease)).toBeNull();
    expect(await jobById(db, main.id)).toMatchObject({
      status: 'running',
      publicationRevoked: false,
      writerHeld: true,
    });
    expect(
      await executions.resolveRouting(channel.id, pending.id, 1, {
        memberIds: [writer.id],
        reason: 'Late',
        status: 'assigned',
      }),
    ).toBe(false);
    await expect(asOwner.retryRouting(channel.id, pending.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(executions.publish(channel.id, running.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await db.select().from(topics).where(eq(topics.id, claim!.topic.id))).toHaveLength(1);
    expect(await db.select().from(agents).where(eq(agents.id, writer.agentId!))).toHaveLength(1);
    const next = await asOwner.send(channel.id, {
      rootMessageId: root.id,
      content: 'New',
      requestKey: 'new',
      mentions: [writer.id],
      routing: 'fallback',
    });
    const [nextJob] = await jobsOf(db, next.id);
    expect(await executions.claim(channel.id, nextJob.id, lease)).toBeNull();
    await executions.releaseWriter(channel.id, running.id);
    expect(await executions.claim(channel.id, nextJob.id, lease)).not.toBeNull();
    expect(await db.select().from(channelThreads).where(eq(channelThreads.id, thread.id))).toEqual([
      expect.objectContaining({ deletedAt: expect.any(Date), isDeleted: true }),
    ]);
  });

  it('cannot revive a deleted branch by retrying its first-send key', async () => {
    const { asOwner, channel, root, thread } = await setup();
    const input = {
      rootMessageId: root.id,
      content: 'Reply',
      requestKey: 'first-send',
      routing: 'fallback' as const,
    };
    await asOwner.send(channel.id, input);
    await asOwner.removeThread(channel.id, thread.id);
    await expect(asOwner.send(channel.id, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await asOwner.detail(channel.id)).threads).toEqual([]);
  });
});
