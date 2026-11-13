// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-source-topic');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** A member asks the Agent and its reply is published from the member's own topic. */
const publishedReply = async () => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Agent');
  const request = await team.asMember.send(team.channel.id, {
    content: 'Question',
    mentions: [agent.id],
    requestKey: 'question',
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, request.id);
  const claimed = (await execution.claim(team.channel.id, job.id, lease))!;
  await execution.accepted(team.channel.id, job.id);
  await execution.saveDraft(team.channel.id, job.id, 'Answer');
  await execution.publish(team.channel.id, job.id);
  await execution.releaseWriter(team.channel.id, job.id);
  const reply = async (repo: typeof team.asOwner) =>
    (await repo.detail(team.channel.id)).messages.find(
      (message) => message.routingStatus === 'reply',
    )!;
  return { ...team, reply, request, topicId: claimed.topic.id };
};

describe('Channel reply source topic', () => {
  it('links a reply to the topic of the member who ran it', async () => {
    const state = await publishedReply();

    expect((await state.reply(state.asMember)).sourceTopicId).toBe(state.topicId);
  });

  it('carries the generated topic title for the member who ran it', async () => {
    const state = await publishedReply();
    await db.update(topics).set({ title: 'Named' }).where(eq(topics.id, state.topicId));

    expect((await state.reply(state.asMember)).sourceTopicTitle).toBe('Named');
    expect((await state.reply(state.asOwner)).sourceTopicTitle).toBeNull();
  });

  it('hides the topic from other members and on requests', async () => {
    const state = await publishedReply();

    expect((await state.reply(state.asOwner)).sourceTopicId).toBeNull();
    const request = (await state.asMember.detail(state.channel.id)).messages.find(
      (message) => message.id === state.request.id,
    )!;
    expect(request.sourceTopicId).toBeNull();
  });

  it('drops the link once the topic is trashed', async () => {
    const state = await publishedReply();
    await db
      .update(topics)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(topics.id, state.topicId));

    expect((await state.reply(state.asMember)).sourceTopicId).toBeNull();
  });
});
