// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  channelJobs,
  channelMembers,
  channelMessages,
  channelThreads,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { readManifestMessages } from '../manifest';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reply-opening');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const mentionAgent = async (content = 'Why did yesterday’s deploy fail?') => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Coder');
  const message = await team.asMember.send(team.channel.id, {
    content,
    mentions: [agent.id],
    requestKey: `req-${content.length}`,
    routing: 'decision',
  });
  const [job] = await jobsOf(db, message.id);

  return { ...team, agent, job, message };
};

const messagesOf = (channelId: string) =>
  db
    .select()
    .from(channelMessages)
    .where(eq(channelMessages.channelId, channelId))
    .orderBy(channelMessages.sequence);

describe('Channel reply opening', () => {
  it('hands the opener the request, the Agent and whether a Thread can open', async () => {
    const { agent, channel, job, message } = await mentionAgent();

    const candidate = await execution.openingCandidate(channel.id, job.id);

    expect(candidate).toMatchObject({
      addressed: true,
      agent: { id: agent.agentId, name: 'Coder' },
      canOpenThread: true,
      recent: [],
      request: { content: 'Why did yesterday’s deploy fail?', id: message.id },
      requesterUserId: fixture.memberId,
    });
  });

  it('acknowledges in the main timeline, once, and the run continues from it', async () => {
    const { agent, channel, job, message } = await mentionAgent();

    expect(await execution.open(channel.id, job.id, { ack: 'Got it, checking the logs.' })).toBe(
      true,
    );
    expect(await execution.open(channel.id, job.id, { ack: 'Again' })).toBe(false);
    expect(await execution.openingCandidate(channel.id, job.id)).toBeUndefined();

    const ack = (await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply');
    expect(ack).toEqual([
      expect.objectContaining({
        agentId: agent.agentId,
        content: 'Got it, checking the logs.',
        replyToId: message.id,
        threadId: null,
        userId: null,
      }),
    ]);
    expect(await execution.openingReply(channel.id, job.id)).toBe('Got it, checking the logs.');
    expect((await jobById(db, job.id)).threadId).toBeNull();
  });

  it('marks the acknowledgement in the list preview, so it raises no notification, and not the answer', async () => {
    const { channel, job } = await mentionAgent();
    const repository = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    const preview = async () =>
      (await repository.list()).find((item) => item.id === channel.id)?.lastMessage;
    expect(await preview()).toMatchObject({ opening: false });

    await execution.open(channel.id, job.id, {
      ack: 'On it, comparing the two configs first.',
      threadTitle: 'Deploy failure',
    });
    expect(await preview()).toMatchObject({
      content: 'On it, comparing the two configs first.',
      opening: true,
      thread: { title: 'Deploy failure' },
    });

    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'The token expired.');
    await execution.publish(channel.id, job.id);
    expect(await preview()).toMatchObject({ content: 'The token expired.', opening: false });
  });

  it('names the acknowledgement on the job, so a failed run shows under it', async () => {
    const { channel, job } = await mentionAgent();
    await execution.open(channel.id, job.id, { ack: 'Got it, checking CI.' });
    const claimed = (await execution.claim(channel.id, job.id, lease))!;
    await execution.fail(channel.id, claimed.job.id, { message: "You've hit your 5-hour limit" });

    const ack = (await messagesOf(channel.id)).find((row) => row.routingStatus === 'reply');
    const repository = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    const { jobs } = await repository.detail(channel.id);
    expect(jobs).toEqual([
      expect.objectContaining({
        errorMessage: "You've hit your 5-hour limit",
        id: job.id,
        openingMessageId: ack!.id,
        status: 'failed',
      }),
    ]);
  });

  it('names the device picked for the Agent, and finds its newest finished reply on it', async () => {
    const { agent, asMember, channel, job } = await mentionAgent();
    const claimed = (await execution.claim(channel.id, job.id, lease))!;
    await execution.fail(channel.id, claimed.job.id, { message: "You've hit your 5-hour limit" });
    // The member runs on a device picked in the Channel; the claim records it on the job.
    await db.update(channelJobs).set({ deviceId: 'device-a' }).where(eq(channelJobs.id, job.id));
    await db
      .update(channelMembers)
      .set({ config: { deviceId: 'device-a' } })
      .where(eq(channelMembers.id, agent.id));
    const next = await asMember.send(channel.id, {
      content: 'Can you retry now?',
      mentions: [agent.id],
      requestKey: 'req-retry',
      routing: 'decision',
    });
    const [nextJob] = await jobsOf(db, next.id);
    const since = new Date(Date.now() - 60_000);

    expect(await execution.openingCandidate(channel.id, nextJob.id)).toMatchObject({
      deviceId: 'device-a',
      memberId: agent.id,
    });
    // The queued reply is not finished yet: the failed one is the newest on the device.
    expect(
      await execution.lastSettledReplyOnDevice(channel.id, {
        deviceId: 'device-a',
        memberId: agent.id,
        since,
      }),
    ).toMatchObject({ error: { message: "You've hit your 5-hour limit" }, status: 'failed' });
    // Another device has no history of its own.
    expect(
      await execution.lastSettledReplyOnDevice(channel.id, {
        deviceId: 'device-b',
        memberId: agent.id,
        since,
      }),
    ).toBeUndefined();

    // A newer reply that finished on the device takes over.
    await db
      .update(channelJobs)
      .set({ deviceId: 'device-a', status: 'completed' })
      .where(eq(channelJobs.id, nextJob.id));
    expect(
      await execution.lastSettledReplyOnDevice(channel.id, {
        deviceId: 'device-a',
        memberId: agent.id,
        since,
      }),
    ).toMatchObject({ status: 'completed' });
  });

  it('names no acknowledgement on a job that opened without one', async () => {
    const { channel, job } = await mentionAgent();
    await execution.open(channel.id, job.id, {});

    const repository = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    const { jobs } = await repository.detail(channel.id);
    expect(jobs).toEqual([expect.objectContaining({ id: job.id, openingMessageId: null })]);
  });

  it('in a group with several people, opens the Thread under the request and acknowledges inside it', async () => {
    const { channel, job, member, message } = await mentionAgent();

    await execution.open(channel.id, job.id, {
      ack: 'On it, I will compare the two configs first.',
      threadTitle: 'Deploy failure',
    });

    // The Thread opens under the request …
    const [thread] = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.channelId, channel.id));
    expect(thread).toMatchObject({
      metadata: { title: 'Deploy failure' },
      rootMessageId: message.id,
    });
    expect(new Set(thread.followerMemberIds)).toEqual(new Set([member.id, job.memberId]));
    expect((await jobById(db, job.id)).threadId).toBe(thread.id);
    // … and the acknowledgement answers the request inside it, not on the shared timeline.
    const [ack] = await db
      .select()
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.channelId, channel.id),
          eq(channelMessages.requestKey, `opening:${job.id}`),
        ),
      );
    expect(ack).toMatchObject({ replyToId: message.id, threadId: thread.id });

    // The run starts in the Thread, still sees the request, and its answer lands there.
    const claim = await execution.claim(channel.id, job.id, lease);
    expect(claim?.job.manifest).toMatchObject({
      cutoffSequence: message.sequence,
      threadId: thread.id,
      threadRootSequence: message.sequence,
    });
    expect((await execution.input(channel.id, job.id)).map(({ id }) => id)).toEqual([message.id]);
    expect(await execution.openingReply(channel.id, job.id)).toBe(
      'On it, I will compare the two configs first.',
    );
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'The token expired.');
    const replyId = await execution.publish(channel.id, job.id);
    const [reply] = await db.select().from(channelMessages).where(eq(channelMessages.id, replyId));
    expect(reply.threadId).toBe(thread.id);

    const repository = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    const detail = await repository.detail(channel.id);
    expect(detail.threads).toEqual([expect.objectContaining({ title: 'Deploy failure' })]);
    expect(detail.messages.map(({ id }) => id)).toEqual([message.id]);
    const inThread = await repository.detail(channel.id, { threadId: thread.id });
    expect(inThread.messages.map(({ id }) => id)).toEqual([ack.id, replyId]);
  });

  it('with one person, acknowledges in the main timeline and moves the reply into a Thread under it', async () => {
    const repository = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const { channel } = await repository.create({ title: 'Solo' });
    const agent = await fixture.addAgent(channel.id, 'Coder');
    const message = await repository.send(channel.id, {
      content: 'Why did yesterday’s deploy fail?',
      mentions: [agent.id],
      requestKey: 'solo',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, message.id);

    await execution.open(channel.id, job.id, {
      ack: 'On it, I will compare the two configs first.',
      threadTitle: 'Deploy failure',
    });

    const [ack] = await db
      .select()
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.channelId, channel.id),
          eq(channelMessages.requestKey, `opening:${job.id}`),
        ),
      );
    expect(ack).toMatchObject({ replyToId: message.id, threadId: null });
    const [thread] = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.channelId, channel.id));
    expect(thread).toMatchObject({ metadata: { title: 'Deploy failure' }, rootMessageId: ack.id });
    expect((await jobById(db, job.id)).threadId).toBe(thread.id);
    const claim = await execution.claim(channel.id, job.id, lease);
    expect(claim?.job.manifest).toMatchObject({
      threadId: thread.id,
      threadRootSequence: ack.sequence,
    });
  });

  /** A request mentioning two Agents, one job each. */
  const mentionTwoAgents = async () => {
    const team = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(team.channel.id, 'Coder');
    const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
    const message = await team.asMember.send(team.channel.id, {
      content: 'Why did the deploy fail?',
      mentions: [coder.id, reviewer.id],
      requestKey: 'req-two',
      routing: 'decision',
    });
    const jobs = await jobsOf(db, message.id);
    const jobOf = (memberId: string) => jobs.find((job) => job.memberId === memberId)!;

    return {
      ...team,
      coder,
      coderJob: jobOf(coder.id),
      message,
      reviewer,
      reviewerJob: jobOf(reviewer.id),
    };
  };

  it('makes a second Agent answering in the same Thread follow it', async () => {
    const { channel, coder, coderJob, member, reviewer, reviewerJob } = await mentionTwoAgents();

    await execution.open(channel.id, coderJob.id, { threadTitle: 'Deploy failure' });
    await execution.open(channel.id, reviewerJob.id, { threadTitle: 'Another name' });

    const threads = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.channelId, channel.id));
    expect(threads).toHaveLength(1);
    expect(threads[0].metadata).toEqual({ title: 'Deploy failure' });
    expect(new Set(threads[0].followerMemberIds)).toEqual(
      new Set([member.id, coder.id, reviewer.id]),
    );
    expect((await jobById(db, reviewerJob.id)).threadId).toBe(threads[0].id);
  });

  it('tells each Agent mentioned together who else was asked', async () => {
    const { channel, coderJob, reviewerJob } = await mentionTwoAgents();

    expect(await execution.openingCandidate(channel.id, coderJob.id)).toMatchObject({
      coAddressed: [{ name: 'Reviewer' }],
    });
    expect(await execution.coAddressed(channel.id, reviewerJob.id)).toEqual([
      expect.objectContaining({ name: 'Coder' }),
    ]);
  });

  it('gathers Agents mentioned together into one Thread under the request, acknowledgements included', async () => {
    const { channel, coder, coderJob, member, message, reviewer, reviewerJob } =
      await mentionTwoAgents();

    await execution.open(channel.id, coderJob.id, {
      ack: 'I will start from the build logs.',
      threadTitle: 'Deploy failure',
    });
    // Asked to answer in place, the second Agent still joins the Thread the first one opened.
    await execution.open(channel.id, reviewerJob.id, { ack: 'I will review the config diff.' });

    const threads = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.channelId, channel.id));
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      metadata: { title: 'Deploy failure' },
      rootMessageId: message.id,
    });
    expect(new Set(threads[0].followerMemberIds)).toEqual(
      new Set([member.id, coder.id, reviewer.id]),
    );
    const acks = (await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply');
    expect(acks.map(({ content, threadId }) => ({ content, threadId }))).toEqual([
      { content: 'I will start from the build logs.', threadId: threads[0].id },
      { content: 'I will review the config diff.', threadId: threads[0].id },
    ]);
    expect((await jobById(db, coderJob.id)).threadId).toBe(threads[0].id);
    expect((await jobById(db, reviewerJob.id)).threadId).toBe(threads[0].id);

    // The main timeline keeps only the request; both runs start in the Thread.
    const detail = await new ChannelRepository(db, fixture.memberId, fixture.workspaceId).detail(
      channel.id,
    );
    expect(detail.messages.map(({ id }) => id)).toEqual([message.id]);
    expect(await execution.claim(channel.id, reviewerJob.id, lease)).not.toBeNull();
  });

  it('keeps Agents mentioned together in place when none of them opens a Thread', async () => {
    const { channel, coderJob, reviewerJob } = await mentionTwoAgents();

    await execution.open(channel.id, coderJob.id, { ack: 'Checking.' });
    await execution.open(channel.id, reviewerJob.id, { ack: 'Looking too.' });

    expect(
      await db.select().from(channelThreads).where(eq(channelThreads.channelId, channel.id)),
    ).toEqual([]);
    const acks = (await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply');
    expect(acks.map(({ threadId }) => threadId)).toEqual([null, null]);
  });

  it('moves a follow-up deferred behind the answer into its Thread, where it reads that answer', async () => {
    const { channel, coder, coderJob, reviewer, reviewerJob } = await mentionTwoAgents();
    await db
      .update(channelJobs)
      .set({
        wake: { afterMemberId: coder.id, kind: 'followup', reason: 'routing-deferred' } as never,
      })
      .where(eq(channelJobs.id, reviewerJob.id));

    await execution.open(channel.id, coderJob.id, { threadTitle: 'Deploy failure' });
    const [thread] = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.channelId, channel.id));
    expect(thread.followerMemberIds).toContain(reviewer.id);
    expect((await jobById(db, reviewerJob.id)).threadId).toBe(thread.id);

    await execution.claim(channel.id, coderJob.id, lease);
    await execution.accepted(channel.id, coderJob.id);
    await execution.saveDraft(channel.id, coderJob.id, 'The token expired.');
    await execution.publish(channel.id, coderJob.id);
    await execution.releaseWriter(channel.id, coderJob.id);

    expect(await execution.claim(channel.id, reviewerJob.id, lease)).not.toBeNull();
    expect(await execution.primaryReply(channel.id, reviewerJob.id)).toMatchObject({
      content: 'The token expired.',
    });
  });

  it('gathers a peer that answered in place even once its run has started', async () => {
    const { channel, coder, coderJob, member, message, reviewer, reviewerJob } =
      await mentionTwoAgents();

    // The first Agent chooses to answer in place, and its run starts before any Thread exists.
    await execution.open(channel.id, coderJob.id, { ack: 'Checking the build logs.' });
    expect((await jobById(db, coderJob.id)).threadId).toBeNull();
    expect(await execution.claim(channel.id, coderJob.id, lease)).not.toBeNull();

    // A peer opens the shared Thread afterwards: the run in flight joins it instead of publishing
    // on the timeline.
    await execution.open(channel.id, reviewerJob.id, {
      ack: 'Reviewing the config diff.',
      threadTitle: 'Deploy failure',
    });

    const [thread] = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.channelId, channel.id));
    expect(thread).toMatchObject({
      metadata: { title: 'Deploy failure' },
      rootMessageId: message.id,
    });
    expect(new Set(thread.followerMemberIds)).toEqual(new Set([member.id, coder.id, reviewer.id]));
    expect((await jobById(db, coderJob.id)).threadId).toBe(thread.id);
    expect((await jobById(db, reviewerJob.id)).threadId).toBe(thread.id);

    await execution.accepted(channel.id, coderJob.id);
    await execution.saveDraft(channel.id, coderJob.id, 'The token expired.');
    const replyId = await execution.publish(channel.id, coderJob.id);
    const [reply] = await db.select().from(channelMessages).where(eq(channelMessages.id, replyId));
    expect(reply.threadId).toBe(thread.id);
  });

  it('keeps a reply without an acknowledgement in place when the request’s Thread is archived', async () => {
    const { asOwner, channel, job, message } = await mentionAgent();
    const thread = await asOwner.createThread(channel.id, { rootMessageId: message.id });
    await asOwner.archiveThread(channel.id, thread.id);

    await execution.open(channel.id, job.id, { threadTitle: 'Deploy failure' });

    expect((await jobById(db, job.id)).threadId).toBeNull();
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
  });

  it('opens a fresh Thread under the acknowledgement when the request’s is archived', async () => {
    const { asOwner, channel, job, message } = await mentionAgent();
    const archived = await asOwner.createThread(channel.id, { rootMessageId: message.id });
    await asOwner.archiveThread(channel.id, archived.id);

    await execution.open(channel.id, job.id, { ack: 'On it.', threadTitle: 'Deploy failure' });

    const { threadId } = await jobById(db, job.id);
    expect(threadId).not.toBeNull();
    expect(threadId).not.toBe(archived.id);
    const ack = (await messagesOf(channel.id)).find((row) => row.routingStatus === 'reply');
    expect(ack).toMatchObject({ threadId: null });
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
  });

  it('keeps the acknowledgement out of the next run’s unseen context', async () => {
    const { agent, asMember, channel, job } = await mentionAgent();
    await execution.open(channel.id, job.id, { ack: 'Got it, checking the logs.' });
    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'The token expired.');
    await execution.publish(channel.id, job.id);
    await execution.releaseWriter(channel.id, job.id);

    const next = await asMember.send(channel.id, {
      content: 'Thanks',
      mentions: [agent.id],
      requestKey: 'req-next',
      routing: 'decision',
    });
    const [nextJob] = await jobsOf(db, next.id);
    const claim = await execution.claim(channel.id, nextJob.id, lease);
    expect(claim?.topic.id).toBe((await jobById(db, job.id)).topicId);

    expect(await execution.recentContext(channel.id, nextJob.id)).toEqual({
      messages: [],
      omitted: 0,
    });
  });

  it('moves a long reply in a direct conversation into a Thread under the acknowledgement', async () => {
    const [agent] = await db
      .insert(agents)
      .values({ name: 'Assistant', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const repository = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const { channel } = await repository.create({ agentId: agent.id, title: 'Direct' });
    const message = await repository.send(channel.id, {
      content: 'Summarize this week',
      requestKey: 'direct',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, message.id);

    expect(await execution.openingCandidate(channel.id, job.id)).toMatchObject({
      canOpenThread: true,
    });
    await execution.open(channel.id, job.id, { ack: 'On it.', threadTitle: 'This week' });

    const threads = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.channelId, channel.id));
    expect(threads).toHaveLength(1);
    const ack = (await messagesOf(channel.id)).find((row) => row.routingStatus === 'reply');
    expect(threads[0]).toMatchObject({ rootMessageId: ack?.id });
    expect(threads[0].metadata).toMatchObject({ title: 'This week' });
    expect((await jobById(db, job.id)).threadId).toBe(threads[0].id);
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
  });

  const asFollowup = async (jobId: string, wake: Record<string, unknown>) =>
    db
      .update(channelJobs)
      .set({ wake: { kind: 'followup', ...wake } as never })
      .where(eq(channelJobs.id, jobId));

  it('opens a follow-up that leads the message, telling the opener it was not addressed', async () => {
    const { channel, job } = await mentionAgent();
    await asFollowup(job.id, { named: true, reason: 'named-in-text' });

    expect(await execution.openingCandidate(channel.id, job.id)).toMatchObject({
      addressed: false,
    });
  });

  it('commits a follow-up that acknowledges to answer', async () => {
    const { channel, job } = await mentionAgent();
    await asFollowup(job.id, { named: true, reason: 'named-in-text' });

    await execution.open(channel.id, job.id, {
      ack: 'Got it, I will read the doc first.',
      threadTitle: 'Doc review',
    });

    // The acknowledgement said it will answer: no longer a wake that may stay silent.
    const opened = await jobById(db, job.id);
    expect(opened.wake).toMatchObject({ kind: 'mention', named: true, reason: 'named-in-text' });
    expect(opened.threadId).not.toBeNull();
    expect(await execution.openingReply(channel.id, job.id)).toBe(
      'Got it, I will read the doc first.',
    );
    await execution.claim(channel.id, job.id, lease);
    expect(await execution.silence(channel.id, job.id, 'NO_REPLY')).toBe(false);
  });

  it('keeps a follow-up that does not acknowledge optional, and in place', async () => {
    const { channel, job } = await mentionAgent();
    await asFollowup(job.id, { reason: 'followup-window' });

    expect(await execution.open(channel.id, job.id, { threadTitle: 'Doc review' })).toBe(true);

    const opened = await jobById(db, job.id);
    expect(opened.wake).toMatchObject({ kind: 'followup' });
    expect(opened.threadId).toBeNull();
    expect(
      await db.select().from(channelThreads).where(eq(channelThreads.channelId, channel.id)),
    ).toEqual([]);
    await execution.claim(channel.id, job.id, lease);
    expect(await execution.silence(channel.id, job.id, 'NO_REPLY')).toBe(true);
  });

  it('never opens a follow-up deferred behind another member’s answer', async () => {
    const { channel, coder, reviewerJob } = await mentionTwoAgents();
    await asFollowup(reviewerJob.id, { afterMemberId: coder.id, reason: 'routing-deferred' });

    expect(await execution.openingCandidate(channel.id, reviewerJob.id)).toBeUndefined();
  });

  it('does not count a follow-up that leads the message as asked together with the others', async () => {
    const { channel, coderJob, reviewerJob } = await mentionTwoAgents();
    await asFollowup(reviewerJob.id, { reason: 'routing-uncertain' });

    expect(await execution.openingCandidate(channel.id, coderJob.id)).toMatchObject({
      coAddressed: [],
    });
  });

  it('records an opening that changed nothing, so the opener is not asked again', async () => {
    const { channel, job } = await mentionAgent();

    expect(await execution.open(channel.id, job.id, {})).toBe(true);

    expect(await execution.openingCandidate(channel.id, job.id)).toBeUndefined();
    expect((await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply')).toEqual(
      [],
    );
  });

  it('does not open a job that already started', async () => {
    const { channel, job } = await mentionAgent();
    await execution.claim(channel.id, job.id, lease);

    expect(await execution.openingCandidate(channel.id, job.id)).toBeUndefined();
    expect(await execution.open(channel.id, job.id, { ack: 'Late' })).toBe(false);
  });

  describe('continuing in an open Thread', () => {
    /** A first request answered in its own Thread, then a follow-up on the main timeline. */
    const answeredInThread = async () => {
      const team = await mentionAgent();
      await execution.open(team.channel.id, team.job.id, {
        ack: 'On it.',
        threadTitle: 'Deploy failure',
      });
      await execution.claim(team.channel.id, team.job.id, lease);
      await execution.accepted(team.channel.id, team.job.id);
      await execution.saveDraft(team.channel.id, team.job.id, 'The token expired.');
      await execution.publish(team.channel.id, team.job.id);
      await execution.releaseWriter(team.channel.id, team.job.id);
      const [thread] = await db
        .select()
        .from(channelThreads)
        .where(eq(channelThreads.channelId, team.channel.id));
      const followUp = await team.asMember.send(team.channel.id, {
        content: 'And how do we stop the token expiring again?',
        mentions: [team.agent.id],
        requestKey: 'follow-up',
        routing: 'decision',
      });
      const [job] = await jobsOf(db, followUp.id);
      return { ...team, followUp, followUpJob: job, thread };
    };

    it('shows the opener the open Threads started before the request', async () => {
      const { channel, followUpJob, thread } = await answeredInThread();

      const candidate = await execution.openingCandidate(channel.id, followUpJob.id);

      expect(candidate?.threads).toEqual([
        {
          id: thread.id,
          lastMessage: 'The token expired.',
          root: 'Why did yesterday’s deploy fail?',
          title: 'Deploy failure',
        },
      ]);
    });

    it('leaves out archived Threads', async () => {
      const { channel, followUpJob, thread } = await answeredInThread();
      await db
        .update(channelThreads)
        .set({ status: 'archived' })
        .where(eq(channelThreads.id, thread.id));

      expect((await execution.openingCandidate(channel.id, followUpJob.id))?.threads).toEqual([]);
    });

    it('leaves out a Thread the Agent never answered in', async () => {
      const { channel, asMember, thread } = await answeredInThread();
      const reviewer = await fixture.addAgent(channel.id, 'Reviewer');
      const request = await asMember.send(channel.id, {
        content: 'Clone the repo and map its frontend',
        mentions: [reviewer.id],
        requestKey: 'reviewer',
        routing: 'decision',
      });
      const [job] = await jobsOf(db, request.id);

      expect((await execution.openingCandidate(channel.id, job.id))?.threads).toEqual([]);
      // Nor can the opener move it there by naming the Thread.
      await execution.open(channel.id, job.id, { ack: 'Looking.', threadId: thread.id });
      expect((await jobById(db, job.id)).threadId).toBeNull();
    });

    it('leaves out a Thread quiet for hours before the request', async () => {
      const { channel, followUpJob, thread } = await answeredInThread();
      const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      await db
        .update(channelMessages)
        .set({ createdAt: longAgo })
        .where(eq(channelMessages.threadId, thread.id));
      await db
        .update(channelThreads)
        .set({ createdAt: longAgo })
        .where(eq(channelThreads.id, thread.id));

      expect((await execution.openingCandidate(channel.id, followUpJob.id))?.threads).toEqual([]);
    });

    it('leaves out a Thread another Agent is answering in', async () => {
      const { asMember, channel, followUpJob, thread } = await answeredInThread();
      const reviewer = await fixture.addAgent(channel.id, 'Reviewer');
      await asMember.send(channel.id, {
        content: 'Review this too',
        mentions: [reviewer.id],
        requestKey: 'in-thread',
        routing: 'decision',
        threadId: thread.id,
      });

      expect((await execution.openingCandidate(channel.id, followUpJob.id))?.threads).toEqual([]);
    });

    it('offers only where a quoted request was answered, and hands the opener the quote', async () => {
      const { agent, asMember, asOwner, channel, message, thread } = await answeredInThread();
      // A second request answered in place, on the main timeline.
      const inPlace = await asMember.send(channel.id, {
        content: 'Should the member list match the personal space?',
        mentions: [agent.id],
        requestKey: 'in-place',
        routing: 'decision',
      });
      const [inPlaceJob] = await jobsOf(db, inPlace.id);
      await execution.open(channel.id, inPlaceJob.id, {});

      // From someone else: the same person's request queued right behind theirs would be merged
      // into that run, which opens for both.
      const quoting = await asOwner.send(channel.id, {
        content: 'Why is this UI still unchanged?',
        mentions: [agent.id],
        replyToId: inPlace.id,
        requestKey: 'quoting',
        routing: 'decision',
      });
      const [quotingJob] = await jobsOf(db, quoting.id);
      const candidate = await execution.openingCandidate(channel.id, quotingJob.id);
      expect(candidate?.threads).toEqual([]);
      expect(candidate?.quoted).toMatchObject({
        content: 'Should the member list match the personal space?',
        id: inPlace.id,
      });

      // The first request, answered in the Thread.
      const quotingRoot = await asMember.send(channel.id, {
        content: 'Is this still failing?',
        mentions: [agent.id],
        replyToId: message.id,
        requestKey: 'quoting-root',
        routing: 'decision',
      });
      const [quotingRootJob] = await jobsOf(db, quotingRoot.id);
      expect(
        (await execution.openingCandidate(channel.id, quotingRootJob.id))?.threads.map(
          ({ id }) => id,
        ),
      ).toEqual([thread.id]);
    });

    it('acknowledges on the main timeline with the Thread linked and answers inside it', async () => {
      const { agent, asMember, channel, followUp, followUpJob, member, thread } =
        await answeredInThread();

      expect(
        await execution.open(channel.id, followUpJob.id, {
          ack: 'I will pick this up in the earlier thread.',
          threadId: thread.id,
        }),
      ).toBe(true);

      const [ack] = await db
        .select()
        .from(channelMessages)
        .where(
          and(
            eq(channelMessages.channelId, channel.id),
            eq(channelMessages.requestKey, `opening:${followUpJob.id}`),
          ),
        );
      expect(ack).toMatchObject({
        content: `I will pick this up in the earlier thread. <#${thread.id}>`,
        replyToId: followUp.id,
        threadId: null,
      });
      expect((await jobById(db, followUpJob.id)).threadId).toBe(thread.id);
      const [joined] = await db
        .select()
        .from(channelThreads)
        .where(eq(channelThreads.id, thread.id));
      expect(joined.followerMemberIds).toEqual(expect.arrayContaining([member.id]));

      // The run reads the Thread and the request, which stays on the main timeline.
      expect(await execution.claim(channel.id, followUpJob.id, lease)).toBeTruthy();
      const input = await execution.input(channel.id, followUpJob.id);
      expect(input.at(-1)?.id).toBe(followUp.id);
      await execution.accepted(channel.id, followUpJob.id);
      await execution.saveDraft(channel.id, followUpJob.id, 'Rotate it with the cron.');
      const replyId = await execution.publish(channel.id, followUpJob.id);
      const [reply] = await db
        .select()
        .from(channelMessages)
        .where(eq(channelMessages.id, replyId));
      expect(reply).toMatchObject({ replyToId: followUp.id, threadId: thread.id });
      const [moved] = await db
        .select()
        .from(channelMessages)
        .where(eq(channelMessages.id, followUp.id));
      expect(moved.threadId).toBeNull();
      await execution.releaseWriter(channel.id, followUpJob.id);

      // A later run in the Thread still reads the request that continued there.
      const later = await asMember.send(channel.id, {
        content: 'Summarize what was asked here',
        mentions: [agent.id],
        requestKey: 'later',
        routing: 'decision',
        threadId: thread.id,
      });
      const [laterJob] = await jobsOf(db, later.id);
      expect(await execution.claim(channel.id, laterJob.id, lease)).toBeTruthy();
      const history = await readManifestMessages(
        db,
        channel.id,
        (await jobById(db, laterJob.id)).manifest!,
      );
      expect(history.map(({ id }) => id)).toContain(followUp.id);
    });

    it('keeps the main-timeline message the request quotes in the continued run', async () => {
      const team = await mentionAgent();
      await execution.open(team.channel.id, team.job.id, { threadTitle: 'Deploy failure' });
      await execution.claim(team.channel.id, team.job.id, lease);
      await execution.accepted(team.channel.id, team.job.id);
      await execution.saveDraft(team.channel.id, team.job.id, 'The token expired.');
      await execution.publish(team.channel.id, team.job.id);
      await execution.releaseWriter(team.channel.id, team.job.id);
      const [thread] = await db
        .select()
        .from(channelThreads)
        .where(eq(channelThreads.channelId, team.channel.id));
      // A note on the main timeline, after the Thread's root, settled without waking anyone.
      const note = await team.asMember.send(team.channel.id, {
        content: 'Rotate it with the cron, not by hand.',
        mentions: [],
        requestKey: 'note',
        routing: 'decision',
      });
      await db
        .update(channelMessages)
        .set({ routingStatus: 'skipped' })
        .where(eq(channelMessages.id, note.id));
      const request = await team.asMember.send(team.channel.id, {
        content: 'Apply this correction',
        mentions: [team.agent.id],
        replyToId: note.id,
        requestKey: 'apply',
        routing: 'decision',
      });
      const [job] = await jobsOf(db, request.id);

      await execution.open(team.channel.id, job.id, { ack: 'On it.', threadId: thread.id });
      expect(await execution.claim(team.channel.id, job.id, lease)).toBeTruthy();

      expect((await execution.input(team.channel.id, job.id)).map(({ id }) => id)).toEqual([
        note.id,
        request.id,
      ]);
    });

    it('takes a follow-up deferred behind it into the Thread, where it reads the answer', async () => {
      const team = await fixture.createTeamChannel();
      const coder = await fixture.addAgent(team.channel.id, 'Coder');
      const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
      const first = await team.asMember.send(team.channel.id, {
        content: 'Why did the deploy fail?',
        mentions: [coder.id],
        requestKey: 'first',
        routing: 'decision',
      });
      const [firstJob] = await jobsOf(db, first.id);
      await execution.open(team.channel.id, firstJob.id, { threadTitle: 'Deploy failure' });
      await execution.claim(team.channel.id, firstJob.id, lease);
      await execution.accepted(team.channel.id, firstJob.id);
      await execution.saveDraft(team.channel.id, firstJob.id, 'The token expired.');
      await execution.publish(team.channel.id, firstJob.id);
      await execution.releaseWriter(team.channel.id, firstJob.id);
      const [thread] = await db
        .select()
        .from(channelThreads)
        .where(eq(channelThreads.channelId, team.channel.id));

      const followUp = await team.asMember.send(team.channel.id, {
        content: 'How do we stop it expiring again?',
        mentions: [coder.id, reviewer.id],
        requestKey: 'second',
        routing: 'decision',
      });
      const jobs = await jobsOf(db, followUp.id);
      const coderJob = jobs.find((job) => job.memberId === coder.id)!;
      const reviewerJob = jobs.find((job) => job.memberId === reviewer.id)!;
      await asFollowup(reviewerJob.id, { afterMemberId: coder.id, reason: 'routing-deferred' });

      await execution.open(team.channel.id, coderJob.id, {
        ack: 'Picking this up.',
        threadId: thread.id,
      });

      expect((await jobById(db, reviewerJob.id)).threadId).toBe(thread.id);
      const [joined] = await db
        .select()
        .from(channelThreads)
        .where(eq(channelThreads.id, thread.id));
      expect(joined.followerMemberIds).toEqual(expect.arrayContaining([reviewer.id]));

      await execution.claim(team.channel.id, coderJob.id, lease);
      await execution.accepted(team.channel.id, coderJob.id);
      await execution.saveDraft(team.channel.id, coderJob.id, 'Rotate it with the cron.');
      await execution.publish(team.channel.id, coderJob.id);
      await execution.releaseWriter(team.channel.id, coderJob.id);

      expect(await execution.claim(team.channel.id, reviewerJob.id, lease)).not.toBeNull();
      expect(await execution.primaryReply(team.channel.id, reviewerJob.id)).toMatchObject({
        content: 'Rotate it with the cron.',
      });
    });

    it('starts in place when the Thread was not one the opener could pick', async () => {
      const { channel, followUpJob, thread } = await answeredInThread();
      await db
        .update(channelThreads)
        .set({ status: 'archived' })
        .where(eq(channelThreads.id, thread.id));

      await execution.open(channel.id, followUpJob.id, { ack: 'Looking.', threadId: thread.id });

      expect((await jobById(db, followUpJob.id)).threadId).toBeNull();
      expect(await execution.openingReply(channel.id, followUpJob.id)).toBe('Looking.');
    });
  });
});
