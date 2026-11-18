// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMessages } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { MAX_REPLY_MENTION_HOPS } from '../replyMentions';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reply-mentions');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async () => {
  const team = await fixture.createTeamChannel();
  const alpha = await fixture.addAgent(team.channel.id, 'Alpha');
  const beta = await fixture.addAgent(team.channel.id, 'Beta');
  const channelId = team.channel.id;

  /** Runs the job `memberId` has on `messageId` and publishes `content` as its reply. */
  const answer = async (messageId: string, memberId: string, content: string) => {
    const job = (await jobsOf(db, messageId)).find((item) => item.memberId === memberId)!;
    await execution.claim(channelId, job.id, lease);
    await execution.accepted(channelId, job.id);
    await execution.saveDraft(channelId, job.id, content);
    const replyId = await execution.publish(channelId, job.id);
    await execution.releaseWriter(channelId, job.id);
    return replyId;
  };
  const reply = async (id: string) =>
    (await db.select().from(channelMessages).where(eq(channelMessages.id, id)))[0];

  const request = await team.asOwner.send(channelId, {
    content: '@Alpha start',
    mentions: [alpha.id],
    requestKey: 'person',
    routing: 'fallback',
  });

  return { alpha, answer, beta, channelId, reply, request, team };
};

describe('@mentions in Agent replies', () => {
  it('records them and wakes the mentioned Agent for the same requester', async () => {
    const { alpha, answer, beta, channelId, reply, request, team } = await setup();
    const replyId = await answer(request.id, alpha.id, '@Beta please review, `@Alpha` stays code');

    const result = await execution.deliverReplyMentions(channelId, replyId);
    expect(result).toMatchObject({ mentions: [beta.id], woke: true });
    expect(await reply(replyId)).toMatchObject({
      mentions: [beta.id],
      metadata: { mentionHops: 1 },
    });
    const [job] = await jobsOf(db, replyId);
    expect(job).toMatchObject({ memberId: beta.id, requesterMemberId: team.owner.id });

    // Idempotent: a retried completion queues nothing more.
    expect(await execution.deliverReplyMentions(channelId, replyId)).toMatchObject({
      mentions: [],
      woke: false,
    });
    expect(await jobsOf(db, replyId)).toHaveLength(1);
  });

  it('ignores the replying Agent naming itself', async () => {
    const { alpha, answer, channelId, request } = await setup();
    const replyId = await answer(request.id, alpha.id, 'I am @Alpha');

    expect(await execution.deliverReplyMentions(channelId, replyId)).toMatchObject({
      mentions: [],
      woke: false,
    });
  });

  it("never resolves the speaker's own name to a shorter or shared one", async () => {
    const team = await fixture.createTeamChannel();
    const speaker = await fixture.addAgent(team.channel.id, 'Sam Smith');
    // A shorter name it starts with, and another member sharing it.
    await fixture.addAgent(team.channel.id, 'Sam');
    await fixture.addAgent(team.channel.id, 'Sam Smith');
    const request = await team.asOwner.send(team.channel.id, {
      content: '@Sam Smith start',
      mentions: [speaker.id],
      requestKey: 'person',
      routing: 'fallback',
    });
    const [job] = (await jobsOf(db, request.id)).filter((item) => item.memberId === speaker.id);
    await execution.claim(team.channel.id, job.id, lease);
    await execution.accepted(team.channel.id, job.id);
    await execution.saveDraft(team.channel.id, job.id, 'I am @Sam Smith');
    const replyId = await execution.publish(team.channel.id, job.id);

    expect(await execution.deliverReplyMentions(team.channel.id, replyId)).toMatchObject({
      mentions: [],
      woke: false,
    });
    expect(await jobsOf(db, replyId)).toEqual([]);
  });

  it('stops waking after the ping-pong limit but keeps the mention', async () => {
    const { alpha, answer, beta, channelId, reply, request } = await setup();
    let messageId = request.id;
    let speaker = alpha;
    for (let hop = 1; hop <= MAX_REPLY_MENTION_HOPS + 1; hop++) {
      const other = speaker.id === alpha.id ? beta : alpha;
      const replyId = await answer(messageId, speaker.id, `@${other.name} your turn`);
      const result = await execution.deliverReplyMentions(channelId, replyId);
      expect(result.mentions).toEqual([other.id]);
      expect(result.woke).toBe(hop <= MAX_REPLY_MENTION_HOPS);
      if (hop > MAX_REPLY_MENTION_HOPS) {
        expect(await jobsOf(db, replyId)).toEqual([]);
        expect((await reply(replyId)).metadata).not.toHaveProperty('mentionHops');
      }
      messageId = replyId;
      speaker = other;
    }
  });
});
