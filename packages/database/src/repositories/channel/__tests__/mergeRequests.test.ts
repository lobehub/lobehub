// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations } from '../../../schemas';
import type { ChannelRepository } from '..';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-merge-requests');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const execution = new ChannelExecutionRepository(db);

const send = async (as: ChannelRepository, channelId: string, content: string) => {
  const message = await as.send(channelId, { content, requestKey: content, routing: 'fallback' });
  const [job] = await jobsOf(db, message.id);
  return { job, message };
};

/** Finishes a claimed job with a published reply. */
const finish = async (channelId: string, jobId: string) => {
  await execution.accepted(channelId, jobId);
  await execution.saveDraft(channelId, jobId, 'Answer');
  await execution.publish(channelId, jobId);
  await execution.releaseWriter(channelId, jobId);
};

/** A team Channel whose one Agent is busy answering the owner's first message. */
const busyAgent = async () => {
  const team = await fixture.createTeamChannel();
  await fixture.addAgent(team.channel.id, 'Agent');
  const first = await send(team.asOwner, team.channel.id, 'first');
  await execution.claim(team.channel.id, first.job.id, lease);
  return { ...team, first };
};

describe('Requests one person sends in a row while the Agent is busy', () => {
  it('are answered together in the next run, not one run each', async () => {
    const { asOwner, channel, first } = await busyAgent();
    const second = await send(asOwner, channel.id, 'second');
    const third = await send(asOwner, channel.id, 'third');
    const fourth = await send(asOwner, channel.id, 'fourth');

    await finish(channel.id, first.job.id);
    const claim = await execution.claim(channel.id, second.job.id, lease);

    expect(claim?.job.manifest).toMatchObject({
      cutoffSequence: fourth.message.sequence,
      requestMessageId: fourth.message.id,
      requestMessageIds: [second.message.id, third.message.id, fourth.message.id],
    });
    expect((await jobById(db, third.job.id)).status).toBe('merged');
    expect((await jobById(db, fourth.job.id)).status).toBe('merged');
    expect(
      (await execution.input(channel.id, second.job.id)).map(({ content }) => content),
    ).toEqual(['second', 'third', 'fourth']);
    // Nothing is left queued behind the merged run.
    expect(
      (await asOwner.detail(channel.id)).jobs.filter((job) => job.status === 'queued'),
    ).toEqual([]);
  });

  it('stops merging at a request from someone else', async () => {
    const { asMember, asOwner, channel, first } = await busyAgent();
    const second = await send(asOwner, channel.id, 'second');
    const other = await send(asMember, channel.id, 'from the member');
    const third = await send(asOwner, channel.id, 'third');

    await finish(channel.id, first.job.id);
    const claim = await execution.claim(channel.id, second.job.id, lease);

    expect(claim?.job.manifest?.requestMessageId).toBe(second.message.id);
    expect(claim?.job.manifest?.requestMessageIds).toBeUndefined();
    expect((await jobById(db, other.job.id)).status).toBe('queued');
    expect((await jobById(db, third.job.id)).status).toBe('queued');
  });

  it('opens one reply for the batch, not one per request', async () => {
    const { asOwner, channel } = await busyAgent();
    const second = await send(asOwner, channel.id, 'second');
    const third = await send(asOwner, channel.id, 'third');

    expect(await execution.openingCandidate(channel.id, second.job.id)).toBeDefined();
    expect(await execution.openingCandidate(channel.id, third.job.id)).toBeUndefined();
  });

  it('queues the merged requests again when their run is retried', async () => {
    const team = await fixture.createTeamChannel();
    await fixture.addAgent(team.channel.id, 'Device Agent');
    const first = await send(team.asOwner, team.channel.id, 'first');
    const second = await send(team.asOwner, team.channel.id, 'second');
    const claim = await execution.claim(team.channel.id, first.job.id, lease);
    expect(claim?.job.manifest?.requestMessageIds).toEqual([first.message.id, second.message.id]);

    await db
      .update(agentOperations)
      .set({
        error: { message: 'offline', type: 'DeviceGatewayNotConfigured' },
        status: 'error',
      })
      .where(eq(agentOperations.id, claim!.job.operationId!));
    await execution.fail(team.channel.id, first.job.id, { message: 'Agent could not start' });
    await execution.releaseWriter(team.channel.id, first.job.id);
    await team.asOwner.retryJob(team.channel.id, first.job.id);

    expect((await jobById(db, second.job.id)).status).toBe('queued');
    const again = await execution.claim(team.channel.id, first.job.id, lease);
    expect(again?.job.manifest?.requestMessageIds).toEqual([first.message.id, second.message.id]);
  });
});
