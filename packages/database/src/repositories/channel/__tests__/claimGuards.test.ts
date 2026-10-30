// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { UserModel } from '../../../models/user';
import { channelJobs, channelMemberGrants, channelMembers, devices } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, deviceConfig, jobsOf, lease } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-claim-guards');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const jobById = async (jobId: string) => {
  const [job] = await db.select().from(channelJobs).where(eq(channelJobs.id, jobId));
  return job;
};

/** Posts as `model`, mentioning `agentId`, and returns the queued job. */
const request = async (
  model: ChannelRepository,
  channelId: string,
  agentId: string,
  key: string,
) => {
  const message = await model.send(channelId, {
    content: key,
    mentions: [agentId],
    requestKey: key,
    routing: 'decision',
  });
  const [job] = await jobsOf(db, message.id);
  return { job, message };
};

/** Claims and finishes a job with a published reply. */
const answer = async (channelId: string, jobId: string) => {
  await execution.claim(channelId, jobId, lease);
  await execution.accepted(channelId, jobId);
  await execution.saveDraft(channelId, jobId, 'Answer');
  await execution.publish(channelId, jobId);
  await execution.releaseWriter(channelId, jobId);
};

describe('claim guards', () => {
  it('requires an approved grant that matches the device, directory and owner', async () => {
    const { asOwner, channel, member } = await fixture.createTeamChannel();
    // A private device owned by the member, not shared with the workspace.
    await db
      .insert(devices)
      .values({ deviceId: 'device-2', identitySource: 'fallback', userId: fixture.memberId });
    const agent = await fixture.addAgent(
      channel.id,
      'Coder',
      deviceConfig('/repo', 'device-2', fixture.memberId),
    );
    const grant = {
      channelId: channel.id,
      deviceId: 'device-2',
      deviceOwnerId: fixture.memberId,
      memberId: agent.id,
      requestedByMemberId: member.id,
      status: 'approved' as const,
      workingDirectory: '/elsewhere',
    };
    const first = await request(asOwner, channel.id, agent.id, 'first');

    // No grant at all fails closed.
    expect(await execution.claim(channel.id, first.job.id, lease)).toBeNull();
    expect(await jobById(first.job.id)).toMatchObject({ blockedCode: 'device_approval_pending' });

    // An approval for another directory does not count.
    const [mismatched] = await db.insert(channelMemberGrants).values(grant).returning();
    expect(await execution.claim(channel.id, first.job.id, lease)).toBeNull();

    await db
      .update(channelMemberGrants)
      .set({ workingDirectory: '/repo' })
      .where(eq(channelMemberGrants.id, mismatched.id));
    await answer(channel.id, first.job.id);

    // The grant goes with the owner's account; the device stays locked to this channel.
    await UserModel.deleteUser(db, fixture.memberId);
    const second = await request(asOwner, channel.id, agent.id, 'second');
    expect(await execution.claim(channel.id, second.job.id, lease)).toBeNull();
    expect(await jobById(second.job.id)).toMatchObject({ blockedCode: 'device_approval_pending' });
  });

  it('runs a personal channel only on its owner device', async () => {
    const model = new ChannelRepository(db, fixture.ownerId);
    const { channel } = await model.create({ title: 'Personal' });
    const foreign = await fixture.addAgent(
      channel.id,
      'Foreign',
      deviceConfig('/repo', 'device-3', fixture.memberId),
    );
    const own = await fixture.addAgent(
      channel.id,
      'Own',
      deviceConfig('/repo', 'device-3', fixture.ownerId),
    );

    const blocked = await request(model, channel.id, foreign.id, 'foreign');
    expect(await execution.claim(channel.id, blocked.job.id, lease)).toBeNull();
    expect(await jobById(blocked.job.id)).toMatchObject({ blockedCode: 'unavailable' });

    const allowed = await request(model, channel.id, own.id, 'own');
    expect(await execution.claim(channel.id, allowed.job.id, lease)).not.toBeNull();
  });

  it('cancels a job whose requester left the channel', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    const { job } = await request(asMember, channel.id, agent.id, 'req');

    await db.update(channelMembers).set({ status: 'left' }).where(eq(channelMembers.id, member.id));

    expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
    expect((await jobById(job.id)).status).toBe('cancelled');
  });

  it('gives a retried routing request the history up to itself', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    const unmentioned = await asMember.send(channel.id, {
      content: 'Who can help?',
      requestKey: 'unmentioned',
      routing: 'decision',
    });
    await execution.resolveRouting(channel.id, unmentioned.id, 1, {
      reason: 'Decision unavailable',
      status: 'unassigned',
    });
    const later = await request(asMember, channel.id, agent.id, 'later');
    await answer(channel.id, later.job.id);

    const retried = await asMember.retryRouting(channel.id, unmentioned.id);
    await execution.resolveRouting(channel.id, unmentioned.id, retried.routingAttempt, {
      memberIds: [agent.id],
      reason: 'Coder can help',
      status: 'assigned',
    });
    const [job] = await jobsOf(db, unmentioned.id);
    const { job: claimed } = (await execution.claim(channel.id, job.id, lease))!;

    expect(claimed.manifest).toMatchObject({
      cutoffSequence: unmentioned.sequence,
      requestMessageId: unmentioned.id,
    });
    expect(await execution.input(channel.id, job.id)).toEqual([
      expect.objectContaining({ content: 'Who can help?', id: unmentioned.id }),
    ]);
  });
});
