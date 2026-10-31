// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  channelAudit,
  channelMembers,
  channelMessages,
  channels,
  topics,
} from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-remove');
const executions = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel soft deletion', () => {
  it('lets a personal owner delete, hides the channel and preserves its Agent', async () => {
    const repo = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await repo.create({ title: 'Personal' });
    const agent = await fixture.addAgent(channel.id, 'Keep me');
    expect(await repo.list()).toEqual([
      expect.objectContaining({ id: channel.id, canDelete: true }),
    ]);

    await expect(repo.remove(channel.id)).resolves.toEqual([]);
    expect(await repo.list()).toEqual([]);
    await expect(repo.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      repo.send(channel.id, { content: 'No', requestKey: 'after-delete', routing: 'fallback' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await db.select().from(channels).where(eq(channels.id, channel.id))).toEqual([
      expect.objectContaining({ deletedAt: expect.any(Date), isDeleted: true }),
    ]);
    expect(await db.select().from(agents).where(eq(agents.id, agent.agentId!))).toHaveLength(1);
    await expect(repo.remove(channel.id)).resolves.toEqual([]);
    expect(
      (await db.select().from(channelAudit).where(eq(channelAudit.channelId, channel.id))).filter(
        (row) => row.event === 'trashed',
      ),
    ).toHaveLength(1);
  });

  it('permits channel admins, but not ordinary members or callers in another scope', async () => {
    const { asMember, asOwner, channel, member } = await fixture.createTeamChannel();
    expect(await asMember.list()).toEqual([expect.objectContaining({ canDelete: false })]);
    expect(await asOwner.list()).toEqual([expect.objectContaining({ canDelete: true })]);
    await expect(asMember.remove(channel.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      new ChannelRepository(db, fixture.ownerId).remove(channel.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      new ChannelRepository(db, fixture.ownerId, 'another-workspace').remove(channel.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db.update(channelMembers).set({ role: 'admin' }).where(eq(channelMembers.id, member.id));
    expect(await asMember.list()).toEqual([expect.objectContaining({ canDelete: true })]);
    await asMember.remove(channel.id);
    expect(await asOwner.list()).toEqual([]);
    await expect(asOwner.detail(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rechecks a revoked membership or demoted admin rather than trusting a cached capability', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    await db.update(channelMembers).set({ role: 'admin' }).where(eq(channelMembers.id, member.id));
    expect(await asMember.list()).toEqual([expect.objectContaining({ canDelete: true })]);
    await db.update(channelMembers).set({ role: 'member' }).where(eq(channelMembers.id, member.id));
    await expect(asMember.remove(channel.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db
      .update(channelMembers)
      .set({ role: 'admin', status: 'removed' })
      .where(eq(channelMembers.id, member.id));
    await expect(asMember.remove(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not let another personal user delete someone else’s channel', async () => {
    const repo = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await repo.create({ title: 'Private' });
    await expect(
      new ChannelRepository(db, fixture.memberId).remove(channel.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await repo.list()).toHaveLength(1);
  });

  it('cancels all branches, fences late routing and publication, and retains physical writer receipts', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Writer');
    const root = await asOwner.send(channel.id, {
      content: 'Work',
      mentions: [coder.id],
      requestKey: 'main',
      routing: 'fallback',
    });
    const [running] = await jobsOf(db, root.id);
    const claim = await executions.claim(channel.id, running.id, lease);
    await executions.accepted(channel.id, running.id);
    await executions.saveDraft(channel.id, running.id, 'Too late');
    const thread = await asOwner.createThread(channel.id, {
      rootMessageId: root.id,
      followerMemberIds: [coder.id],
    });
    const reply = await asOwner.send(channel.id, {
      content: 'More',
      mentions: [coder.id],
      requestKey: 'thread',
      routing: 'fallback',
      threadId: thread.id,
    });
    const [queued] = await jobsOf(db, reply.id);
    const pending = await asOwner.send(channel.id, {
      content: 'Who?',
      requestKey: 'pending',
      routing: 'decision',
    });
    const writers = await asOwner.remove(channel.id);

    expect(writers.map((job) => job.id)).toEqual([running.id]);
    expect(await jobById(db, running.id)).toMatchObject({
      publicationRevoked: true,
      status: 'cancelled',
      writerHeld: true,
    });
    expect(await jobById(db, queued.id)).toMatchObject({ status: 'cancelled', writerHeld: false });
    expect(await executions.claim(channel.id, queued.id, lease)).toBeNull();
    expect(
      await db.select().from(channelMessages).where(eq(channelMessages.id, pending.id)),
    ).toEqual([expect.objectContaining({ routingAttempt: 2, routingStatus: 'unassigned' })]);
    expect(
      await executions.resolveRouting(channel.id, pending.id, 1, {
        memberIds: [coder.id],
        reason: 'Late result',
        status: 'assigned',
      }),
    ).toBe(false);
    await expect(executions.publish(channel.id, running.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await db.select().from(topics).where(eq(topics.id, claim!.topic.id))).toHaveLength(1);
    // A repeat delete still returns an unconfirmed writer for physical cancellation.
    expect((await asOwner.remove(channel.id)).map((job) => job.id)).toEqual([running.id]);
    await executions.releaseWriter(channel.id, running.id);
    expect(await jobById(db, running.id)).toMatchObject({ status: 'cancelled', writerHeld: false });
    expect(await asOwner.remove(channel.id)).toEqual([]);
  });
});
