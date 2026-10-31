// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentOperations,
  channelJobs,
  channelMessages,
  channels,
  channelThreads,
  topics,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { ChannelSendInput } from '..';
import { ChannelExecutionRepository } from '..';
import { claimJob } from '../claim';
import { lockChannel } from '../transaction';
import {
  createChannelFixture,
  deviceConfig,
  jobsOf,
  lease,
  nativeConfig,
  operationById,
} from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-execution');
const execution = new ChannelExecutionRepository(db);
// Racing transactions need separate connections; PGlite runs them one after another.
const isServerDB = process.env.TEST_SERVER_DB === '1';

/** Resolves once some session in this database is waiting on a lock. */
const waitForLockWaiter = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await db.execute<{ waiting: number }>(
      sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('No transaction started waiting for a lock');
};

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** A team channel with one Agent and a message mentioning it. */
const mentionAgent = async (config = deviceConfig()) => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Coder', config);
  const message = await team.asMember.send(team.channel.id, {
    content: 'Fix it',
    mentions: [agent.id],
    requestKey: 'req-1',
    routing: 'decision',
  });
  const [job] = await jobsOf(db, message.id);

  return { ...team, agent, job, message };
};

const jobById = async (jobId: string) => {
  const [job] = await db.select().from(channelJobs).where(eq(channelJobs.id, jobId));
  return job;
};

const operationOf = async (jobId: string) => operationById(db, (await jobById(jobId)).operationId);

describe('ChannelExecutionRepository', () => {
  it('claims, accepts, publishes and releases a job', async () => {
    const { agent, channel, job, member, message } = await mentionAgent();

    const claim = await execution.claim(channel.id, job.id, lease);
    expect(claim?.job).toMatchObject({
      deviceId: 'device-1',
      leaseOwner: 'worker-1',
      requesterMemberId: member.id,
      status: 'running',
      workingDirectory: '/repo',
      writerHeld: true,
    });
    // Trace storage derives the Agent and topic from the operation ID, as for ordinary runs.
    expect(claim?.job.operationId).toMatch(
      new RegExp(`^op_\\d+_${agent.agentId}_${claim?.topic.id}_[\\dA-Za-z]{8}$`),
    );
    expect(claim?.job.manifest).toEqual({
      cutoffSequence: 1,
      requestMessageId: message.id,
      requesterMemberId: member.id,
      self: { agentId: agent.agentId, memberId: agent.id, name: 'Coder' },
      threadId: null,
      threadRootSequence: null,
    });
    expect(await execution.input(channel.id, job.id)).toEqual([
      expect.objectContaining({ author: { id: fixture.memberId, name: 'mia', type: 'user' } }),
    ]);

    await execution.accepted(channel.id, job.id);
    expect((await jobById(job.id)).acceptedAt).toBeInstanceOf(Date);
    expect(await operationOf(job.id)).toMatchObject({
      status: 'running',
      topicId: claim!.topic.id,
    });

    await execution.saveDraft(channel.id, job.id, 'Fixed');
    await expect(execution.saveDraft(channel.id, job.id, 'Changed')).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const replyId = await execution.publish(channel.id, job.id);
    expect(await execution.publish(channel.id, job.id)).toBe(replyId);
    const [reply] = await db.select().from(channelMessages).where(eq(channelMessages.id, replyId));
    expect(reply).toMatchObject({
      agentId: agent.agentId,
      userId: null,
      replyToId: message.id,
      routingStatus: 'reply',
      sequence: 2,
    });
    expect(reply.content).toBe('Fixed');
    expect((await operationOf(job.id)).status).toBe('running');
    expect((await jobById(job.id)).status).toBe('completed');

    const releasedState = {
      leaseOwner: null,
      publishedMessageId: replyId,
      status: 'completed',
      writerHeld: false,
    };
    await execution.releaseWriter(channel.id, job.id);
    expect(await jobById(job.id)).toMatchObject(releasedState);
    expect((await operationOf(job.id)).status).toBe('done');
    await execution.releaseWriter(channel.id, job.id);
    expect(await jobById(job.id)).toMatchObject(releasedState);
  });

  it('continues the Agent topic and its hetero session with only new public input', async () => {
    const { agent, asMember, channel, job } = await mentionAgent();
    const first = (await execution.claim(channel.id, job.id, lease))!;
    await db
      .update(topics)
      .set({ metadata: { heteroSessionId: 'session-1' } })
      .where(eq(topics.id, first.topic.id));
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'Done');
    await execution.publish(channel.id, job.id);
    await execution.releaseWriter(channel.id, job.id);

    const next = await asMember.send(channel.id, {
      content: 'Again',
      mentions: [agent.id],
      requestKey: 'req-2',
      routing: 'decision',
    });
    const [nextJob] = await jobsOf(db, next.id);
    const second = (await execution.claim(channel.id, nextJob.id, lease))!;

    expect(second.topic.id).toBe(first.topic.id);
    expect(second.topic.metadata?.heteroSessionId).toBe('session-1');
    expect((await execution.input(channel.id, nextJob.id)).map((m) => m.sequence)).toEqual([3]);
    expect((await operationById(db, second.job.operationId)).topicId).toBe(second.topic.id);
  });

  it('freezes a branch cutoff instead of message content and reads it after later sends', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    const mainAgent = await fixture.addAgent(channel.id, 'Main', nativeConfig);
    const threadAgent = await fixture.addAgent(channel.id, 'Thread', nativeConfig);
    const send = (requestKey: string, input: Partial<ChannelSendInput> = {}) =>
      asMember.send(channel.id, { content: requestKey, requestKey, routing: 'decision', ...input });
    const root = await send('root', { mentions: [member.id] });
    const [thread] = await db
      .insert(channelThreads)
      .values({ channelId: channel.id, rootMessageId: root.id, rootSequence: root.sequence })
      .returning();
    await send('main-after-root', { mentions: [member.id] });
    const mainRequest = await send('main-request', { mentions: [mainAgent.id] });
    const threadRequest = await send('thread-request', {
      mentions: [threadAgent.id],
      threadId: thread.id,
    });
    const [mainJob] = await jobsOf(db, mainRequest.id);
    const [threadJob] = await jobsOf(db, threadRequest.id);
    await expect(execution.input(channel.id, mainJob.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const mainClaim = (await execution.claim(channel.id, mainJob.id, lease))!;
    const threadClaim = (await execution.claim(channel.id, threadJob.id, lease))!;
    await send('main-after-claim');
    await send('thread-after-claim', { threadId: thread.id });

    // The job stores where its input ends, so its size does not grow with the branch.
    expect(mainClaim.job.manifest).toEqual({
      cutoffSequence: mainRequest.sequence,
      requestMessageId: mainRequest.id,
      requesterMemberId: member.id,
      self: { agentId: mainAgent.agentId, memberId: mainAgent.id, name: 'Main' },
      threadId: null,
      threadRootSequence: null,
    });
    expect(threadClaim.job.manifest).toMatchObject({
      cutoffSequence: threadRequest.sequence,
      threadId: thread.id,
      threadRootSequence: root.sequence,
    });
    const contents = async (jobId: string) =>
      (await execution.input(channel.id, jobId)).map((message) => message.content);
    expect(await contents(mainJob.id)).toEqual(['main-request']);
    expect(await contents(threadJob.id)).toEqual(['thread-request']);
  });

  it('answers in message order and holds one writer per member', async () => {
    const { agent, asMember, channel, job } = await mentionAgent();
    const next = await asMember.send(channel.id, {
      content: 'Second',
      mentions: [agent.id],
      requestKey: 'req-2',
      routing: 'decision',
    });
    const [nextJob] = await jobsOf(db, next.id);

    expect(await execution.claim(channel.id, nextJob.id, lease)).toBeNull();
    expect(await jobById(nextJob.id)).toMatchObject({ blockedCode: 'member_busy' });
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
    expect(await execution.claim(channel.id, nextJob.id, lease)).toBeNull();
    expect(await jobById(nextJob.id)).toMatchObject({ blockedCode: 'member_busy' });

    expect(await execution.retireReservation(channel.id, job.id)).toBe(true);
    expect(await jobById(job.id)).toMatchObject({ status: 'failed', writerHeld: false });
    expect(await execution.claim(channel.id, nextJob.id, lease)).not.toBeNull();
    expect(await jobById(nextJob.id)).toMatchObject({ blockedCode: null });
  });

  it('claims independent Agents concurrently while keeping a shared directory exclusive', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const first = await fixture.addAgent(channel.id, 'First', deviceConfig());
    const second = await fixture.addAgent(channel.id, 'Second', deviceConfig());
    const native = await fixture.addAgent(channel.id, 'Native', nativeConfig);
    const message = await asMember.send(channel.id, {
      content: 'Together',
      mentions: [first.id, second.id, native.id],
      requestKey: 'parallel',
      routing: 'decision',
    });
    const jobs = await jobsOf(db, message.id);
    const claims = await Promise.all(jobs.map((job) => execution.claim(channel.id, job.id, lease)));
    expect(claims.filter(Boolean)).toHaveLength(2);
    expect(claims.some((claim) => claim?.member.id === native.id)).toBe(true);
    const blocked = jobs[claims.findIndex((claim) => !claim)];
    expect(await jobById(blocked.id)).toMatchObject({
      blockedCode: 'directory_locked',
      status: 'queued',
      writerHeld: false,
    });
  });

  it('blocks a job while another channel uses the same device directory', async () => {
    const first = await mentionAgent();
    await execution.claim(first.channel.id, first.job.id, lease);

    const asOther = await fixture.createTeamChannel('Other');
    const otherAgent = await fixture.addAgent(asOther.channel.id, 'Coder', deviceConfig());
    const message = await asOther.asMember.send(asOther.channel.id, {
      content: 'Same repo',
      mentions: [otherAgent.id],
      requestKey: 'req-1',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, message.id);

    expect(await execution.claim(asOther.channel.id, job.id, lease)).toBeNull();
    expect(await jobById(job.id)).toMatchObject({ blockedCode: 'directory_locked' });

    // Isolation lets the member move on but does not free the directory.
    await execution.isolate(first.channel.id, first.job.id, 'termination unconfirmed');
    expect(await jobById(first.job.id)).toMatchObject({
      isolatedAt: expect.any(Date),
      status: 'failed',
      writerHeld: true,
    });
    expect(await execution.claim(asOther.channel.id, job.id, lease)).toBeNull();

    await execution.releaseWriter(first.channel.id, first.job.id);
    expect(await jobById(first.job.id)).toMatchObject({ status: 'failed', writerHeld: false });
    expect(await execution.claim(asOther.channel.id, job.id, lease)).not.toBeNull();
    expect(await jobById(job.id)).toMatchObject({ blockedCode: null, status: 'running' });
  });

  it('lets Agents without a chosen directory share the device home folder', async () => {
    const home = { ...deviceConfig('/Users/me'), implicitWorkingDirectory: true };
    const first = await mentionAgent(home);
    expect(await execution.claim(first.channel.id, first.job.id, lease)).not.toBeNull();

    const other = await fixture.createTeamChannel('Other');
    const otherAgent = await fixture.addAgent(other.channel.id, 'Coder', home);
    const message = await other.asMember.send(other.channel.id, {
      content: 'Quick question',
      mentions: [otherAgent.id],
      requestKey: 'req-1',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, message.id);

    const claim = await execution.claim(other.channel.id, job.id, lease);
    expect(claim?.job).toMatchObject({
      blockedCode: null,
      deviceId: 'device-1',
      status: 'running',
      workingDirectory: null,
      writerHeld: true,
    });
    // The run still executes in the home folder; only the lock is skipped.
    expect(claim?.job.executionConfig).toMatchObject({ workingDirectory: '/Users/me' });
  });

  it.skipIf(!isServerDB)(
    'blocks the loser of a concurrent claim on the same directory',
    async () => {
      const first = await mentionAgent();
      const other = await fixture.createTeamChannel('Other');
      const otherAgent = await fixture.addAgent(other.channel.id, 'Coder', deviceConfig());
      const message = await other.asMember.send(other.channel.id, {
        content: 'Same repo',
        mentions: [otherAgent.id],
        requestKey: 'req-1',
        routing: 'decision',
      });
      const [job] = await jobsOf(db, message.id);

      // The first claim takes the writer but has not committed when the second one checks.
      let inserted!: () => void;
      const writerTaken = new Promise<void>((resolve) => (inserted = resolve));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      const winner = db.transaction(async (tx) => {
        const channel = await lockChannel(tx, first.channel.id);
        await claimJob(tx, channel, first.job.id, lease);
        inserted();
        await released;
      });

      await writerTaken;
      const loser = execution.claim(other.channel.id, job.id, lease);
      await waitForLockWaiter();
      release();
      await winner;

      expect(await loser).toBeNull();
      expect(
        await db
          .select()
          .from(agentOperations)
          .where(eq(agentOperations.agentId, otherAgent.agentId!)),
      ).toHaveLength(0);
      expect(
        await db.select().from(topics).where(eq(topics.agentId, otherAgent.agentId!)),
      ).toHaveLength(0);
      expect(await jobById(job.id)).toMatchObject({
        blockedCode: 'directory_locked',
        operationId: null,
        status: 'queued',
        writerHeld: false,
      });
    },
  );

  it('fails the job when the writer ends without a reply', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id);

    await execution.releaseWriter(channel.id, job.id);

    expect(await jobById(job.id)).toMatchObject({
      publicationRevoked: true,
      status: 'failed',
      writerHeld: false,
    });
    expect(await operationOf(job.id)).toMatchObject({
      error: { message: 'The run ended without a reply' },
      status: 'error',
    });
  });

  it('settles the job of an unknown execution without redelivering it', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);
    await execution.executionUnknown(channel.id, job.id, 'receipt lost');
    expect((await operationOf(job.id)).status).toBe('abandoned');

    expect(await jobById(job.id)).toMatchObject({
      publicationRevoked: true,
      status: 'failed',
      writerHeld: true,
    });

    // A late receipt cannot revive it.
    await expect(execution.accepted(channel.id, job.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await jobById(job.id)).acceptedAt).toBeNull();

    await execution.releaseWriter(channel.id, job.id);

    expect(await jobById(job.id)).toMatchObject({
      publicationRevoked: true,
      status: 'failed',
      writerHeld: false,
    });
  });

  it('keeps an unknown execution unpublishable after the runtime settled its operation', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);
    const { operationId } = await jobById(job.id);
    await db
      .update(agentOperations)
      .set({ status: 'error' })
      .where(eq(agentOperations.id, operationId!));

    await execution.executionUnknown(channel.id, job.id, 'receipt lost');

    await expect(execution.accepted(channel.id, job.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(execution.publish(channel.id, job.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('fails an accepted draft whose execution became unknown', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'Done');
    const { operationId } = await jobById(job.id);
    await db
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, operationId!));

    await execution.executionUnknown(channel.id, job.id, 'receipt lost');
    await execution.releaseWriter(channel.id, job.id);

    expect(await jobById(job.id)).toMatchObject({
      publicationRevoked: true,
      status: 'failed',
      writerHeld: false,
    });
    await expect(execution.publish(channel.id, job.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('still releases the writer after its operation row is gone', async () => {
    const { agent, asMember, channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);
    const { operationId } = await jobById(job.id);
    await db.delete(agentOperations).where(eq(agentOperations.id, operationId!));

    await execution.releaseWriter(channel.id, job.id);

    expect(await jobById(job.id)).toMatchObject({
      operationId: null,
      status: 'failed',
      writerHeld: false,
    });
    const next = await asMember.send(channel.id, {
      content: 'Next',
      mentions: [agent.id],
      requestKey: 'req-2',
      routing: 'decision',
    });
    const [nextJob] = await jobsOf(db, next.id);
    expect(await execution.claim(channel.id, nextJob.id, lease)).not.toBeNull();
  });

  it('ignores a late failure once the job published or settled', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'Done');
    const replyId = await execution.publish(channel.id, job.id);

    await execution.fail(channel.id, job.id, { message: 'late error' });
    expect(await jobById(job.id)).toMatchObject({
      publicationRevoked: false,
      publishedMessageId: replyId,
      status: 'completed',
      writerHeld: true,
    });
    expect(await operationOf(job.id)).toMatchObject({ error: null, status: 'running' });

    await execution.releaseWriter(channel.id, job.id);
    await execution.fail(channel.id, job.id, { message: 'later error' });
    expect((await jobById(job.id)).status).toBe('completed');
    expect(await operationOf(job.id)).toMatchObject({ error: null, status: 'done' });
  });

  it('keeps the first outcome of a released job', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);
    await execution.executionUnknown(channel.id, job.id, 'receipt lost');
    await execution.releaseWriter(channel.id, job.id);

    await execution.fail(channel.id, job.id, { message: 'late error' });

    expect(await operationOf(job.id)).toMatchObject({
      error: { message: 'receipt lost' },
      status: 'abandoned',
    });
    expect((await jobById(job.id)).status).toBe('failed');
  });

  it('keeps an accepted draft publishable after the writer is released', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'Done');

    await execution.releaseWriter(channel.id, job.id);
    expect(await jobById(job.id)).toMatchObject({ status: 'running', writerHeld: false });

    await execution.publish(channel.id, job.id);
    expect((await jobById(job.id)).status).toBe('completed');
  });

  it('refuses unclaimed or revoked jobs and trashed channels', async () => {
    const { agent, asMember, channel, job } = await mentionAgent();
    await expect(execution.accepted(channel.id, job.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await execution.claim(channel.id, job.id, lease);
    await expect(execution.publish(channel.id, job.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    expect(await execution.retireReservation(channel.id, job.id)).toBe(true);
    await expect(execution.accepted(channel.id, job.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const next = await asMember.send(channel.id, {
      content: 'Next',
      mentions: [agent.id],
      requestKey: 'req-2',
      routing: 'decision',
    });
    const [nextJob] = await jobsOf(db, next.id);
    await db
      .update(channels)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(channels.id, channel.id));
    expect(await execution.claim(channel.id, nextJob.id, lease)).toBeNull();
  });

  it('renews the lease only for the live owner', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);

    expect(await execution.heartbeat(job.id, lease)).toBe(true);
    expect(await execution.heartbeat(job.id, { ...lease, leaseOwner: 'other' })).toBe(false);

    expect(await execution.retireReservation(channel.id, job.id)).toBe(true);
    expect(await execution.heartbeat(job.id, lease)).toBe(false);
  });
});
