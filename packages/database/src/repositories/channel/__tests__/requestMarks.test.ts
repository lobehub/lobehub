// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMessages, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRoutingRepository } from '..';
import {
  CHANNEL_JOB_ANSWERED_REACTION,
  CHANNEL_JOB_WORKING_REACTION,
  reactionsByMessage,
} from '../reactions';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-request-marks');
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

/** A message routed to `reviewer`, who owes an answer, and to `coder` as a follow-up. */
const routed = async () => {
  const team = await fixture.createTeamChannel();
  const coder = await fixture.addAgent(team.channel.id, 'Coder');
  const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
  const message = await team.asMember.send(team.channel.id, {
    content: 'Can someone look at the deploy?',
    requestKey: 'deploy',
    routing: 'decision',
  });
  const input = await routing.claim(team.channel.id, message.id);
  await execution.resolveRouting(team.channel.id, message.id, input!.attempt, {
    memberIds: [coder.id, reviewer.id],
    reason: 'test',
    status: 'assigned',
    wakes: { [coder.id]: { kind: 'followup', reason: 'followup-window' } },
  });
  const jobs = await jobsOf(db, message.id);
  const marks = async () =>
    (await reactionsByMessage(db, team.channel.id, [message.id])).get(message.id) ?? [];
  return {
    channelId: team.channel.id,
    coder: jobs.find((job) => job.memberId === coder.id)!,
    marks,
    reviewer: jobs.find((job) => job.memberId === reviewer.id)!,
  };
};

describe('the mark an Agent leaves on a request it owes an answer', () => {
  it('shows 👀 once the run takes the request, then ✅ once the reply is out', async () => {
    const { channelId, marks, reviewer } = await routed();
    await execution.claim(channelId, reviewer.id, lease);
    await execution.accepted(channelId, reviewer.id);

    expect(await marks()).toEqual([
      { count: 1, emoji: CHANNEL_JOB_WORKING_REACTION, memberIds: [reviewer.memberId] },
    ]);

    await execution.saveDraft(channelId, reviewer.id, 'The deploy is green again.');
    await execution.publish(channelId, reviewer.id);
    await execution.releaseWriter(channelId, reviewer.id);

    expect(await marks()).toEqual([
      { count: 1, emoji: CHANNEL_JOB_ANSWERED_REACTION, memberIds: [reviewer.memberId] },
    ]);
  });

  it('takes the 👀 back when the run ends without a reply', async () => {
    const { channelId, marks, reviewer } = await routed();
    await execution.claim(channelId, reviewer.id, lease);
    await execution.accepted(channelId, reviewer.id);
    await execution.fail(channelId, reviewer.id, { message: 'boom' });
    await execution.releaseWriter(channelId, reviewer.id);

    expect(await marks()).toEqual([]);
  });

  it('leaves no mark for a follow-up wake, which may stay silent', async () => {
    const { channelId, coder, marks } = await routed();
    await execution.claim(channelId, coder.id, lease);
    await execution.accepted(channelId, coder.id);
    expect(await marks()).toEqual([]);

    await execution.silence(channelId, coder.id, 'not_addressed');
    await execution.releaseWriter(channelId, coder.id);
    expect(await marks()).toEqual([]);
  });

  it('never fails the job over a reaction the request refuses', async () => {
    const { channelId, reviewer } = await routed();
    await execution.claim(channelId, reviewer.id, lease);
    // The request was deleted for everyone: it takes no reaction, yet the run goes on.
    await db
      .update(channelMessages)
      .set({ metadata: { deletedAt: new Date().toISOString() } })
      .where(eq(channelMessages.id, reviewer.messageId));
    await expect(execution.accepted(channelId, reviewer.id)).resolves.toBeUndefined();
  });
});
