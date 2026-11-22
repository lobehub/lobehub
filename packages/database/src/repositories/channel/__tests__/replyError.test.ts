// @vitest-environment node
import type { ChannelReplyError } from '@lobechat/types';
import { channelMessageReplyError } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, channelJobs, channelMessages } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { ChannelReplyErrorDraft } from '..';
import { ChannelExecutionRepository } from '..';
import { readManifestMessages } from '../manifest';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reply-error');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const draft: ChannelReplyErrorDraft = {
  actions: ['resume', 'retry'],
  errorMessage: 'Operation abandoned: inactivity_watchdog',
  errorType: null,
  occurredAt: '2026-11-20T00:00:00.000Z',
  summary: 'Coder stopped making progress, so the system ended this reply.',
};

const messagesOf = (channelId: string) =>
  db
    .select()
    .from(channelMessages)
    .where(eq(channelMessages.channelId, channelId))
    .orderBy(channelMessages.sequence);

/** The member @mentions the Coder; `ack` opens the reply first, as the opener would. */
const askCoder = async ({ ack }: { ack?: string } = {}) => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Coder');
  const helper = await fixture.addAgent(team.channel.id, 'Helper');
  const message = await team.asMember.send(team.channel.id, {
    content: 'Why did the deploy fail?',
    mentions: [agent.id],
    requestKey: 'req-deploy',
    routing: 'decision',
  });
  const [job] = await jobsOf(db, message.id);
  if (ack) await execution.open(team.channel.id, job.id, { ack });
  return { ...team, agent, helper, job, message };
};

/** Claims the job, accepts its input and lets the run die like the watchdog abandons it. */
const runAndAbandon = async (channelId: string, jobId: string) => {
  const claim = await execution.claim(channelId, jobId, lease);
  await execution.accepted(channelId, jobId);
  await db
    .update(agentOperations)
    .set({ error: { message: draft.errorMessage! }, status: 'abandoned' })
    .where(eq(agentOperations.id, claim!.job.operationId!));
  await execution.fail(channelId, jobId, { message: 'Agent execution ended without a reply' });
  await execution.releaseWriter(channelId, jobId);
  return claim!.job.operationId!;
};

const cardOf = (message: { metadata: unknown }) =>
  channelMessageReplyError(message.metadata as Record<string, unknown>) as ChannelReplyError;

describe('A failed reply leaves a card in its reply slot', () => {
  it('posts the card as the Agent when the reply never opened, without waking anyone', async () => {
    const { agent, asMember, channel, job, message } = await askCoder();
    const operationId = await runAndAbandon(channel.id, job.id);
    const before = (await asMember.list()).find((item) => item.id === channel.id)!;

    const posted = await execution.postReplyError(channel.id, job.id, draft);

    expect(posted).toMatchObject({ changed: true });
    const [, card] = await messagesOf(channel.id);
    expect(card).toMatchObject({
      agentId: agent.agentId,
      content: draft.summary,
      id: posted!.messageId,
      mentions: [],
      replyToId: message.id,
      routingStatus: 'reply',
      threadId: null,
      userId: null,
    });
    expect(cardOf(card)).toEqual({ ...draft, attempts: 1, jobId: job.id, operationId });
    // A real message: the requester has it unread. It woke nobody.
    const after = (await asMember.list()).find((item) => item.id === channel.id)!;
    expect(after.unreadCount).toBe(before.unreadCount + 1);
    expect(await jobsOf(db, card.id)).toEqual([]);
    // The detail view carries the card on the message and keeps the job's own failure fields.
    const detail = await asMember.detail(channel.id);
    expect(detail.messages.find((row) => row.id === card.id)?.replyError).toMatchObject({
      jobId: job.id,
      summary: draft.summary,
    });
    expect(detail.jobs.find((row) => row.id === job.id)).toMatchObject({
      errorMessage: draft.errorMessage,
      status: 'failed',
    });
  });

  it('turns the opening acknowledgement into the card and moves it to the end', async () => {
    const { channel, job } = await askCoder({ ack: 'On it, checking the logs.' });
    const [, ack] = await messagesOf(channel.id);
    expect(await execution.openingReply(channel.id, job.id)).toBe('On it, checking the logs.');
    await runAndAbandon(channel.id, job.id);

    const posted = await execution.postReplyError(channel.id, job.id, draft);

    expect(posted?.messageId).toBe(ack.id);
    const rows = await messagesOf(channel.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ content: draft.summary, id: ack.id });
    expect(rows[1].sequence).toBeGreaterThan(ack.sequence);
    expect(cardOf(rows[1]).attempts).toBe(1);
    // The run is no longer told it acknowledged.
    expect(await execution.openingReply(channel.id, job.id)).toBeUndefined();
  });

  it('updates the same card on a repeated failure, and ignores the same run reported twice', async () => {
    const { asMember, channel, job } = await askCoder();
    await runAndAbandon(channel.id, job.id);
    const first = await execution.postReplyError(channel.id, job.id, draft);
    expect(await execution.postReplyError(channel.id, job.id, draft)).toMatchObject({
      changed: false,
      messageId: first!.messageId,
    });

    await asMember.retryJob(channel.id, job.id);
    const second = await runAndAbandon(channel.id, job.id);
    await execution.postReplyError(channel.id, job.id, { ...draft, summary: 'Again.' });

    const cards = (await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ content: 'Again.', id: first!.messageId });
    expect(cardOf(cards[0])).toMatchObject({ attempts: 2, operationId: second });
  });

  it('refines only the card of the run it was asked about', async () => {
    const { channel, job } = await askCoder();
    const operationId = await runAndAbandon(channel.id, job.id);
    await execution.postReplyError(channel.id, job.id, draft);

    expect(
      await execution.refineReplyError(channel.id, job.id, 'op_other', {
        actions: ['retry'],
        summary: 'Stale.',
      }),
    ).toBe(false);
    expect(
      await execution.refineReplyError(channel.id, job.id, operationId, {
        actions: ['retry', 'resume'],
        summary: 'Coder went quiet for an hour.',
      }),
    ).toBe(true);
    expect(await execution.replyError(channel.id, job.id)).toMatchObject({
      actions: ['retry', 'resume'],
      attempts: 1,
      summary: 'Coder went quiet for an hour.',
    });
  });

  it('is replaced in place by the reply a resumed run publishes', async () => {
    const { asMember, channel, job } = await askCoder();
    const failedOperation = await runAndAbandon(channel.id, job.id);
    const failed = await jobById(db, job.id);
    const posted = await execution.postReplyError(channel.id, job.id, draft);

    await asMember.retryJob(channel.id, job.id, 'resume');
    const claim = await execution.claim(channel.id, job.id, lease);
    expect(claim?.job.operationId).not.toBe(failedOperation);
    expect(claim?.topic.id).toBe(failed.topicId);
    expect(claim?.job.manifest?.resumed).toBe(true);
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'The migration timed out.');
    const replyId = await execution.publish(channel.id, job.id);

    expect(replyId).toBe(posted!.messageId);
    const replies = (await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ content: 'The migration timed out.', id: replyId });
    expect(channelMessageReplyError(replies[0].metadata)).toBeUndefined();
    expect((await asMember.detail(channel.id)).messages.at(-1)?.replyError).toBeNull();
  });

  it('gives a reply published over an adopted acknowledgement the reply’s own request key', async () => {
    const { asMember, channel, job } = await askCoder({ ack: 'On it, checking the logs.' });
    await execution.openingReply(channel.id, job.id);
    await runAndAbandon(channel.id, job.id);
    const posted = await execution.postReplyError(channel.id, job.id, draft);
    expect(posted?.messageId).toBeDefined();

    await asMember.retryJob(channel.id, job.id, 'resume');
    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id);
    await execution.saveDraft(channel.id, job.id, 'The migration timed out.');
    await execution.publish(channel.id, job.id);

    const [reply] = (await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply');
    // The slot was the acknowledgement: publishing over it must not leave it reading as one,
    // or `threadSummaries.lastNewsAt` keeps the earlier timestamp.
    expect(reply).toMatchObject({ id: posted!.messageId, requestKey: `job:${job.id}` });
  });

  it('reads a shared run’s card without the owner’s failure text', async () => {
    const { asMember, channel, job } = await askCoder();
    await runAndAbandon(channel.id, job.id);
    await db
      .update(channelJobs)
      .set({
        executionConfig: {
          share: { ownerId: 'usr_owner', shareId: 'shr_shared', workspaceId: null },
        },
      })
      .where(eq(channelJobs.id, job.id));
    await execution.postReplyError(channel.id, job.id, draft);

    const detail = await asMember.detail(channel.id);
    const card = detail.messages.find((row) => row.replyError?.jobId === job.id)?.replyError;
    // Written while the share showed details; the read applies the visitor projection anyway.
    expect(card?.errorMessage).toBeNull();
    expect(card?.errorType).toBeNull();
    expect(card?.summary).toBe(draft.summary);
  });

  it('starts a fresh conversation on retry, and resumes only a reply that had one', async () => {
    const { asMember, channel, job } = await askCoder();
    await runAndAbandon(channel.id, job.id);
    const failed = await jobById(db, job.id);

    await asMember.retryJob(channel.id, job.id);
    const claim = await execution.claim(channel.id, job.id, lease);
    expect(claim?.topic.id).not.toBe(failed.topicId);
    expect(claim?.job.manifest?.resumed).toBeUndefined();

    await execution.fail(channel.id, job.id, { message: 'boom' });
    await execution.releaseWriter(channel.id, job.id);
    await db.update(channelJobs).set({ topicId: null }).where(eq(channelJobs.id, job.id));
    await expect(asMember.retryJob(channel.id, job.id, 'resume')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('shows other Agents only that the reply did not finish', async () => {
    const { asMember, channel, helper, job } = await askCoder();
    await runAndAbandon(channel.id, job.id);
    await execution.postReplyError(channel.id, job.id, draft);

    const next = await asMember.send(channel.id, {
      content: 'Helper, can you take a look?',
      mentions: [helper.id],
      requestKey: 'req-helper',
      routing: 'decision',
    });
    const [helperJob] = await jobsOf(db, next.id);
    const claim = await execution.claim(channel.id, helperJob.id, lease);
    const context = await readManifestMessages(db, channel.id, claim!.job.manifest!);

    expect(context.map((message) => message.content)).toEqual([
      'Why did the deploy fail?',
      'Coder did not finish this reply.',
      'Helper, can you take a look?',
    ]);
  });

  it('writes no card for a reply that did not fail', async () => {
    const { asMember, channel, job } = await askCoder();
    await execution.claim(channel.id, job.id, lease);
    await asMember.stop(channel.id, { jobId: job.id });

    expect(await execution.replyErrorFacts(channel.id, job.id)).toBeUndefined();
    expect(await execution.postReplyError(channel.id, job.id, draft)).toBeUndefined();
    expect((await messagesOf(channel.id)).filter((row) => row.routingStatus === 'reply')).toEqual(
      [],
    );
  });
});
