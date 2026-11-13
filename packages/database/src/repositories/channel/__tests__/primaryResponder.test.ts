// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelJobs, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRoutingRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-primary-responder');
const execution = new ChannelExecutionRepository(db);
const routing = new ChannelRoutingRepository(db);

beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values({
    role: 'member',
    userId: fixture.memberId,
    workspaceId: fixture.workspaceId,
  });
});
afterEach(fixture.cleanup);

/**
 * One routed message: `coder` is its primary responder, `reviewer` a follow-up deferred behind
 * it, as `assignWithPrimary` decides it.
 */
const routed = async () => {
  const team = await fixture.createTeamChannel();
  const coder = await fixture.addAgent(team.channel.id, 'Coder');
  const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
  const message = await team.asMember.send(team.channel.id, {
    content: 'Can someone fix the parser?',
    requestKey: 'parser',
    routing: 'decision',
  });
  const input = await routing.claim(team.channel.id, message.id);
  await execution.resolveRouting(team.channel.id, message.id, input!.attempt, {
    memberIds: [coder.id, reviewer.id],
    reason: 'test',
    status: 'assigned',
    wakes: {
      [reviewer.id]: { afterMemberId: coder.id, kind: 'followup', reason: 'routing-deferred' },
    },
  });
  const jobs = await jobsOf(db, message.id);
  return {
    channelId: team.channel.id,
    primary: jobs.find((job) => job.memberId === coder.id)!,
    deferred: jobs.find((job) => job.memberId === reviewer.id)!,
  };
};

/** The primary runs to a published reply. */
const answer = async (channelId: string, jobId: string, content: string) => {
  await execution.accepted(channelId, jobId);
  await execution.saveDraft(channelId, jobId, content);
  return execution.publish(channelId, jobId);
};

describe('one primary responder per message', () => {
  it('queues the deferred follow-up as awaiting the primary from delivery on', async () => {
    const { deferred, primary } = await routed();

    expect(primary).toMatchObject({ blockedCode: null, status: 'queued', wake: null });
    // Never reads as "replying" before it can run: the client keys off this code.
    expect(deferred).toMatchObject({ blockedCode: 'awaiting_primary', status: 'queued' });
  });

  it('starts the follow-up only after the primary settles, with its reply in view', async () => {
    const { channelId, deferred, primary } = await routed();

    expect(await execution.claim(channelId, deferred.id, lease)).toBeNull();
    const claimed = (await execution.claim(channelId, primary.id, lease))!;
    expect(claimed).not.toBeNull();
    // Still running: the follow-up keeps waiting.
    expect(await execution.claim(channelId, deferred.id, lease)).toBeNull();
    expect((await jobById(db, deferred.id)).blockedCode).toBe('awaiting_primary');

    const replyId = await answer(channelId, claimed.job.id, 'Fixed in the tokenizer.');
    const follow = (await execution.claim(channelId, deferred.id, lease))!;

    expect(follow.job).toMatchObject({ blockedCode: null, status: 'running' });
    expect(follow.job.manifest?.primaryReplyMessageId).toBe(replyId);
    expect(await execution.primaryReply(channelId, deferred.id)).toMatchObject({
      author: { name: 'Coder', type: 'agent' },
      content: 'Fixed in the tokenizer.',
      id: replyId,
    });
    // The history cutoff stays at the request; only the reply itself is handed over.
    expect(follow.job.manifest?.cutoffSequence).toBe(claimed.job.manifest?.cutoffSequence);
    expect(await execution.primaryReply(channelId, claimed.job.id)).toBeNull();
  });

  it('still runs the follow-up when the primary fails or stays silent, without a reply', async () => {
    const { channelId, deferred, primary } = await routed();
    const claimed = (await execution.claim(channelId, primary.id, lease))!;
    await execution.fail(channelId, claimed.job.id, { message: 'boom' });

    const follow = (await execution.claim(channelId, deferred.id, lease))!;
    expect(follow).not.toBeNull();
    expect(follow.job.manifest?.primaryReplyMessageId).toBeUndefined();
  });

  it('does not wait behind a primary stuck on a device or a person', async () => {
    const { channelId, deferred, primary } = await routed();
    await db
      .update(channelJobs)
      .set({ blockedCode: 'device_offline', blockedReason: 'offline' })
      .where(eq(channelJobs.id, primary.id));

    expect(await execution.claim(channelId, deferred.id, lease)).not.toBeNull();
  });

  it('keeps waiting while the primary is only queued behind its own earlier work', async () => {
    const { channelId, deferred, primary } = await routed();
    await db
      .update(channelJobs)
      .set({ blockedCode: 'member_busy', blockedReason: 'busy' })
      .where(eq(channelJobs.id, primary.id));

    expect(await execution.claim(channelId, deferred.id, lease)).toBeNull();
  });
});

describe('explicit mentions', () => {
  it('keep every mentioned Agent as an owed, parallel answer', async () => {
    const team = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(team.channel.id, 'Coder');
    const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
    const message = await team.asMember.send(team.channel.id, {
      content: 'Both of you, please look',
      mentions: [coder.id, reviewer.id],
      requestKey: 'both',
    });
    const jobs = await jobsOf(db, message.id);

    expect(jobs).toHaveLength(2);
    for (const job of jobs) expect(job).toMatchObject({ blockedCode: null, wake: null });
    for (const job of jobs)
      expect(await execution.claim(team.channel.id, job.id, lease)).not.toBeNull();
  });
});
