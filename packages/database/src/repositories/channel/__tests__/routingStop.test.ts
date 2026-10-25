// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMessages, channelThreads } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease, operationById } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-routing-stop');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const messageById = async (messageId: string) => {
  const [message] = await db
    .select()
    .from(channelMessages)
    .where(eq(channelMessages.id, messageId));
  return message;
};

describe('routing write-back', () => {
  it('delivers a current Jev decision to the chosen candidates only', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Coder');
    await fixture.addAgent(channel.id, 'Reviewer');
    const message = await asMember.send(channel.id, {
      content: 'Who knows?',
      requestKey: 'req-1',
      routing: 'jev',
    });

    expect(
      await execution.resolveRouting(channel.id, message.id, 1, {
        memberIds: [coder.id, 'chn_member_outsider'],
        reason: 'Coder owns this code',
        status: 'assigned',
      }),
    ).toBe(true);

    expect(await messageById(message.id)).toMatchObject({
      recipientMemberIds: [coder.id],
      routingSource: 'jev',
      routingStatus: 'assigned',
    });
    expect(await jobsOf(db, message.id)).toEqual([
      expect.objectContaining({ memberId: coder.id, requesterMemberId: member.id }),
    ]);
  });

  it('ignores a stale attempt after a retry', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Coder');
    const message = await asMember.send(channel.id, {
      content: 'Who knows?',
      requestKey: 'req-1',
      routing: 'jev',
    });
    await execution.resolveRouting(channel.id, message.id, 1, {
      reason: 'Unclear',
      status: 'unassigned',
    });

    const retried = await asMember.retryRouting(channel.id, message.id);
    expect(retried).toMatchObject({ routingAttempt: 2, routingStatus: 'pending' });

    const late = await execution.resolveRouting(channel.id, message.id, 1, {
      memberIds: [coder.id],
      reason: 'Late',
      status: 'assigned',
    });
    expect(late).toBe(false);
    expect(await jobsOf(db, message.id)).toEqual([]);
  });

  it('lets only the author or an admin retry routing', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');
    const message = await asOwner.send(channel.id, {
      content: 'Who knows?',
      requestKey: 'req-1',
      routing: 'jev',
    });
    await execution.resolveRouting(channel.id, message.id, 1, {
      reason: 'Unclear',
      status: 'unassigned',
    });

    await expect(asMember.retryRouting(channel.id, message.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(asOwner.retryRouting(channel.id, message.id)).resolves.toMatchObject({
      routingStatus: 'pending',
    });
  });
});

describe('stop', () => {
  it('revokes a job so it can never publish, and lets its requester stop it', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Coder');
    const message = await asOwner.send(channel.id, {
      content: 'Do it',
      mentions: [coder.id],
      requestKey: 'req-1',
      routing: 'jev',
    });
    const [job] = await jobsOf(db, message.id);
    await execution.claim(channel.id, job.id, lease);
    await execution.accepted(channel.id, job.id, { nativeSessionId: 's' });
    await execution.saveDraft(channel.id, job.id, 'Draft');

    await expect(asMember.stop(channel.id, { jobId: job.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const pending = await asOwner.stop(channel.id, { jobId: job.id });

    expect(pending.map((item) => item.id)).toEqual([job.id]);
    expect(await jobById(db, job.id)).toMatchObject({
      publicationRevoked: true,
      status: 'cancelled',
      writerHeld: true,
    });
    await expect(execution.publish(channel.id, job.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await execution.releaseWriter(channel.id, job.id);
    expect(await jobById(db, job.id)).toMatchObject({ status: 'cancelled', writerHeld: false });
    expect((await operationById(db, (await jobById(db, job.id)).operationId)).status).toBe(
      'interrupted',
    );
  });

  it('stops a branch: closes pending routing and cancels queued jobs there only', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Coder');
    const root = await asOwner.send(channel.id, {
      content: 'Root',
      mentions: [coder.id],
      requestKey: 'root',
      routing: 'jev',
    });
    const [thread] = await db
      .insert(channelThreads)
      .values({
        channelId: channel.id,
        followerMemberIds: [coder.id],
        rootMessageId: root.id,
        rootSequence: root.sequence,
      })
      .returning();
    const inThread = await asOwner.send(channel.id, {
      content: 'In thread',
      mentions: [coder.id],
      requestKey: 'thread',
      routing: 'jev',
      threadId: thread.id,
    });
    const pending = await asOwner.send(channel.id, {
      content: 'Anyone?',
      requestKey: 'pending',
      routing: 'jev',
    });

    await expect(asMember.stop(channel.id, { threadId: null })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await asOwner.stop(channel.id, { threadId: null });

    expect(await messageById(pending.id)).toMatchObject({
      routingAttempt: 2,
      routingStatus: 'unassigned',
    });
    expect(
      await execution.resolveRouting(channel.id, pending.id, 1, {
        memberIds: [coder.id],
        reason: 'Late',
        status: 'assigned',
      }),
    ).toBe(false);
    const [mainJob] = await jobsOf(db, root.id);
    const [threadJob] = await jobsOf(db, inThread.id);
    expect(mainJob.status).toBe('cancelled');
    expect(threadJob.status).toBe('queued');
  });
});
