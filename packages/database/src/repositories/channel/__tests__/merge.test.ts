// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelJobs, channelMessages } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { ChannelSteer } from '..';
import { ChannelExecutionRepository } from '..';
import { STUCK_JOB_TTL_MS } from '../claim';
import {
  createChannelFixture,
  deviceConfig,
  jobById,
  jobsOf,
  lease,
  nativeConfig,
} from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-merge');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** A team channel with one Agent, and a way to ask it in the main timeline as either person. */
const setup = async (config = nativeConfig) => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Coder', config);
  let sent = 0;
  const ask = async (
    content: string,
    { as = team.asMember, replyToId }: { as?: typeof team.asMember; replyToId?: string } = {},
  ) => {
    sent += 1;
    const message = await as.send(team.channel.id, {
      content,
      mentions: [agent.id],
      replyToId,
      requestKey: `ask-${sent}`,
      routing: 'decision',
    });
    const [job] = await jobsOf(db, message.id);
    return { job, message };
  };
  return { ...team, agent, ask };
};

/** Runs `steer` for a claimed job's operation, returning what it would write into the run. */
const steer = async (operationId: string) =>
  execution.steer(operationId, {
    join: async (joined: ChannelSteer) => joined,
    serverDefaultAgentConfig: {},
  });

describe('merging queued requests into one reply', () => {
  it('takes the leading queue in at claim, across people, stopping at a deferred follow-up', async () => {
    const { asOwner, ask, channel, member } = await setup();
    const first = await ask('First');
    const second = await ask('Second', { as: asOwner });
    const third = await ask('Third');
    // Deferred behind another member's answer to its own message: it must wait for that.
    await db
      .update(channelJobs)
      .set({ wake: { afterMemberId: member.id, kind: 'followup', reason: 'routing-deferred' } })
      .where(eq(channelJobs.id, third.job.id));
    const fourth = await ask('Fourth');

    const claim = await execution.claim(channel.id, first.job.id, lease);
    expect(claim?.job.manifest).toMatchObject({
      cutoffSequence: second.message.sequence,
      requestMessageIds: [first.message.id, second.message.id],
      // The run keeps the head's execution identity.
      requesterMemberId: member.id,
    });
    expect(await jobById(db, second.job.id)).toMatchObject({
      status: 'merged',
    });
    expect(await jobById(db, third.job.id)).toMatchObject({ status: 'queued' });
    expect(await jobById(db, fourth.job.id)).toMatchObject({ status: 'queued' });
  });

  it('keeps a request relayed from another Channel out, as its answer goes back on its own', async () => {
    const { ask, channel } = await setup();
    const first = await ask('First');
    const relayed = await ask('From elsewhere');
    await db
      .update(channelMessages)
      .set({ metadata: { via: { agentId: 'agt-relay', name: 'Relay' } } })
      .where(eq(channelMessages.id, relayed.message.id));

    await execution.claim(channel.id, first.job.id, lease);
    expect(await jobById(db, relayed.job.id)).toMatchObject({ status: 'queued' });
  });

  it('shows each merged job with the job that answers it, read from that job’s manifest', async () => {
    const { ask, asMember, channel } = await setup();
    const first = await ask('First');
    const second = await ask('Second');
    await execution.claim(channel.id, first.job.id, lease);
    const mergedInto = async () =>
      Object.fromEntries(
        (await asMember.detail(channel.id)).jobs.map((job) => [job.id, job.mergedIntoJobId]),
      );

    expect(await mergedInto()).toEqual({ [first.job.id]: null, [second.job.id]: first.job.id });

    // Handed back by a failed run, it no longer points at that run.
    await execution.accepted(channel.id, first.job.id);
    await execution.fail(channel.id, first.job.id, { message: 'boom' });
    expect((await mergedInto())[second.job.id]).toBeNull();
  });

  it('makes the reply owed when an owed request joins a wake that may stay silent', async () => {
    const { ask, channel } = await setup();
    const first = await ask('Maybe for you');
    await db
      .update(channelJobs)
      .set({ wake: { kind: 'followup', reason: 'followup-window' } })
      .where(eq(channelJobs.id, first.job.id));
    await ask('Definitely for you');

    const claim = await execution.claim(channel.id, first.job.id, lease);
    expect(claim?.job.wake).toBeNull();
  });

  it('gives the requests back to the queue when the run fails', async () => {
    const { ask, channel } = await setup();
    const first = await ask('First');
    const second = await ask('Second');
    await execution.claim(channel.id, first.job.id, lease);
    await execution.accepted(channel.id, first.job.id);

    await execution.fail(channel.id, first.job.id, { message: 'boom' });
    expect(await jobById(db, second.job.id)).toMatchObject({
      status: 'queued',
    });
  });
});

describe('steering queued requests into a running Native run', () => {
  const running = async (config = nativeConfig) => {
    const team = await setup(config);
    const first = await team.ask('First');
    const claim = await execution.claim(team.channel.id, first.job.id, lease);
    await execution.accepted(team.channel.id, first.job.id);
    return { ...team, first, operationId: claim!.job.operationId! };
  };

  it('joins plain-text requests sent while it runs, with what arrived alongside', async () => {
    const { ask, channel, first, operationId } = await running();
    const second = await ask('How is it going?');

    const joined = await steer(operationId);
    expect(joined).toMatchObject({ channelId: channel.id, jobId: first.job.id, omitted: 0 });
    expect(joined?.requests.map(({ id }) => id)).toEqual([second.message.id]);
    expect(joined?.manifest).toMatchObject({
      cutoffSequence: second.message.sequence,
      requestMessageIds: [first.message.id, second.message.id],
    });
    expect(await jobById(db, second.job.id)).toMatchObject({
      status: 'merged',
    });
    // Nothing is left to join, and the run's input now covers both requests.
    expect(await steer(operationId)).toBeUndefined();
    expect((await execution.input(channel.id, first.job.id)).map(({ id }) => id)).toEqual([
      first.message.id,
      second.message.id,
    ]);
  });

  it('leaves a quoting request for the next run, and keeps order behind it', async () => {
    const { ask, first, operationId } = await running();
    const quoting = await ask('About this', { replyToId: first.message.id });
    const after = await ask('And then');

    expect(await steer(operationId)).toBeUndefined();
    expect(await jobById(db, quoting.job.id)).toMatchObject({ status: 'queued' });
    expect(await jobById(db, after.job.id)).toMatchObject({ status: 'queued' });
  });

  it('keeps the requests queued when writing them into the run fails', async () => {
    const { ask, operationId } = await running();
    const second = await ask('Second');

    await expect(
      execution.steer(operationId, {
        join: async () => {
          throw new Error('write failed');
        },
        serverDefaultAgentConfig: {},
      }),
    ).rejects.toThrow('write failed');
    expect(await jobById(db, second.job.id)).toMatchObject({ status: 'queued' });
  });

  it('never steers an external CLI run or one not yet accepted', async () => {
    const external = await running(deviceConfig());
    await external.ask('Second');
    expect(await steer(external.operationId)).toBeUndefined();

    const { ask, channel } = await setup();
    const first = await ask('First');
    const claim = await execution.claim(channel.id, first.job.id, lease);
    await ask('Second');
    expect(await steer(claim!.job.operationId!)).toBeUndefined();
  });
});

describe('around merging', () => {
  it('opens no acknowledgement while the member is still answering the branch', async () => {
    const { ask, channel } = await setup();
    const first = await ask('First');
    expect(await execution.openingCandidate(channel.id, first.job.id)).toBeDefined();
    await execution.claim(channel.id, first.job.id, lease);

    const second = await ask('Second');
    expect(await execution.openingCandidate(channel.id, second.job.id)).toBeUndefined();
  });

  it('cancels a job stuck on a device or a person for days', async () => {
    const { ask, channel } = await setup();
    const { job } = await ask('Anyone?');
    await db
      .update(channelJobs)
      .set({
        blockedCode: 'unavailable',
        blockedReason: 'The Agent is unavailable',
        createdAt: new Date(Date.now() - STUCK_JOB_TTL_MS - 60_000),
      })
      .where(eq(channelJobs.id, job.id));

    expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
    expect(await jobById(db, job.id)).toMatchObject({ blockedCode: null, status: 'cancelled' });
  });
});
