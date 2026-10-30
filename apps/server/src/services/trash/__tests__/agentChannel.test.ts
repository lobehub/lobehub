// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelExecutionRepository, ChannelRepository } from '@/database/repositories/channel';
import {
  createChannelFixture,
  jobsOf,
  lease,
} from '@/database/repositories/channel/__tests__/testUtils';
import { agents, channelJobs, channelMembers, channelMessages } from '@/database/schemas';

import { TrashService } from '../index';

vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/services/channel/notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('@/server/services/channel/queue', () => ({ wakeChannel: vi.fn() }));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'trash-channel-agent');
const executions = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Deleting an Agent that joined a Channel', () => {
  it('keeps public history, retires the member and cancels its queued replies without touching peers', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const target = await fixture.addAgent(channel.id, 'Historical author');
    const peer = await fixture.addAgent(channel.id, 'Still available');
    const history = await asOwner.send(channel.id, {
      content: 'Keep this request',
      mentions: [target.id],
      requestKey: 'history',
      routing: 'fallback',
    });
    const [historicalJob] = await jobsOf(db, history.id);
    await executions.claim(channel.id, historicalJob.id, lease);
    await executions.accepted(channel.id, historicalJob.id);
    await executions.saveDraft(channel.id, historicalJob.id, 'Keep this answer');
    await executions.publish(channel.id, historicalJob.id);
    await executions.releaseWriter(channel.id, historicalJob.id);
    const pending = await asOwner.send(channel.id, {
      content: 'Pending request',
      mentions: [target.id, peer.id],
      requestKey: 'pending',
      routing: 'fallback',
    });
    const before = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.channelId, channel.id));
    const trash = new TrashService(db, fixture.ownerId, fixture.workspaceId);
    const root = await trash.trashAgent(target.agentId!);

    const [member] = await db.select().from(channelMembers).where(eq(channelMembers.id, target.id));
    expect(member).toMatchObject({
      agentId: target.agentId,
      name: 'Historical author',
      status: 'removed',
    });
    expect(
      await db.select().from(channelMessages).where(eq(channelMessages.channelId, channel.id)),
    ).toEqual(before);
    const jobs = await jobsOf(db, pending.id);
    expect(jobs.find((job) => job.memberId === target.id)).toMatchObject({
      blockedCode: null,
      status: 'cancelled',
      writerHeld: false,
    });
    expect(jobs.find((job) => job.memberId === peer.id)).toMatchObject({ status: 'queued' });
    const view = await asOwner.detail(channel.id);
    expect(view.members.find((entry) => entry.id === target.id)).toMatchObject({
      agentDeleted: true,
      status: 'removed',
    });
    expect(
      view.messages.find((message) => message.content === 'Keep this answer')?.author,
    ).toMatchObject({
      name: 'Historical author',
      deleted: true,
    });
    await expect(
      asOwner.send(channel.id, {
        content: 'Stale recipient',
        mentions: [target.id],
        requestKey: 'stale',
        routing: 'fallback',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await trash.restore([root!.id]);
    expect((await jobsOf(db, pending.id)).find((job) => job.memberId === target.id)?.status).toBe(
      'cancelled',
    );
    expect(
      (await asOwner.detail(channel.id)).members.find((entry) => entry.id === target.id)?.status,
    ).toBe('removed');
  });

  it('excludes legacy deleted members from selection and settles their queued work', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const target = await fixture.addAgent(channel.id, 'Legacy deleted');
    const pending = await asOwner.send(channel.id, {
      content: 'Pending',
      mentions: [target.id],
      requestKey: 'pending',
      routing: 'fallback',
    });
    await db
      .update(agents)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(agents.id, target.agentId!));
    expect(
      (await asOwner.detail(channel.id)).members.find((entry) => entry.id === target.id),
    ).toMatchObject({
      agentDeleted: true,
      status: 'removed',
    });
    await expect(asOwner.agentEnvironment(channel.id, target.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      asOwner.updateAgentEnvironment(channel.id, target.id, { workingDirectory: '/stale' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      asOwner.send(channel.id, {
        content: 'Old page',
        mentions: [target.id],
        requestKey: 'stale',
        routing: 'fallback',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const [job] = await jobsOf(db, pending.id);
    expect(await executions.claim(channel.id, job.id, lease)).toBeNull();
    expect((await jobsOf(db, pending.id))[0]).toMatchObject({
      blockedCode: null,
      status: 'cancelled',
    });
    const message = await asOwner.send(channel.id, {
      content: 'No live reply target',
      requestKey: 'auto',
      routing: 'fallback',
    });
    expect(await jobsOf(db, message.id)).toEqual([]);
  });

  it('does not let a different personal user retire another user’s Agent or queued replies', async () => {
    const owner = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await owner.create({ title: 'Personal' });
    const target = await fixture.addAgent(channel.id, 'Private');
    const pending = await owner.send(channel.id, {
      content: 'Pending',
      mentions: [target.id],
      requestKey: 'pending',
      routing: 'fallback',
    });
    expect(await new TrashService(db, fixture.memberId).trashAgent(target.agentId!)).toBeNull();
    expect(
      (await owner.detail(channel.id)).members.find((entry) => entry.id === target.id)?.status,
    ).toBe('active');
    expect((await jobsOf(db, pending.id))[0].status).toBe('queued');
  });

  it('revokes a running reply but retains its writer until termination is confirmed', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const target = await fixture.addAgent(channel.id, 'Running');
    const request = await asOwner.send(channel.id, {
      content: 'Work',
      mentions: [target.id],
      requestKey: 'running',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, request.id);
    await executions.claim(channel.id, job.id, lease);
    await new TrashService(db, fixture.ownerId, fixture.workspaceId).trashAgent(target.agentId!);
    expect((await jobsOf(db, request.id))[0]).toMatchObject({
      publicationRevoked: true,
      status: 'cancelled',
      writerHeld: true,
    });
    await expect(executions.saveDraft(channel.id, job.id, 'Too late')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await executions.releaseWriter(channel.id, job.id);
    expect((await jobsOf(db, request.id))[0].writerHeld).toBe(false);
  });

  it('keeps the public answer and its member name after the deleted Agent is purged', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const target = await fixture.addAgent(channel.id, 'Historical author');
    const request = await asOwner.send(channel.id, {
      content: 'Keep it',
      mentions: [target.id],
      requestKey: 'history',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, request.id);
    await executions.claim(channel.id, job.id, lease);
    await executions.accepted(channel.id, job.id);
    await executions.saveDraft(channel.id, job.id, 'Historical answer');
    await executions.publish(channel.id, job.id);
    await executions.releaseWriter(channel.id, job.id);
    const trash = new TrashService(db, fixture.ownerId, fixture.workspaceId);
    const root = await trash.trashAgent(target.agentId!);
    await trash.purge([root!.id]);
    const view = await asOwner.detail(channel.id);
    expect(
      view.messages.find((message) => message.content === 'Historical answer')?.author,
    ).toMatchObject({
      deleted: true,
      id: null,
      name: 'Historical author',
    });
    expect(view.members.find((entry) => entry.id === target.id)).toMatchObject({
      agentDeleted: true,
      agentId: null,
    });
    expect((await db.select().from(channelJobs).where(eq(channelJobs.id, job.id)))[0].status).toBe(
      'completed',
    );
  });
});
