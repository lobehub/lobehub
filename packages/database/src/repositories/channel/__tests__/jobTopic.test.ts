// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-job-topic');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** A member asks the Agent, and the reply is still running in the member's own topic. */
const runningReply = async () => {
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
  const jobOf = async (repo: typeof team.asOwner) =>
    (await repo.detail(team.channel.id)).jobs.find((entry) => entry.id === job.id)!;
  const jobTopic = async (repo: typeof team.asOwner) => (await jobOf(repo)).topicId;
  return { ...team, jobOf, jobTopic, topicId: claimed.topic.id };
};

describe('Channel job topic', () => {
  it('lets the member running a reply follow it into its topic', async () => {
    const state = await runningReply();

    expect(await state.jobTopic(state.asMember)).toBe(state.topicId);
  });

  it('names the topic for the member running the reply', async () => {
    const state = await runningReply();
    await db.update(topics).set({ title: 'Fix the login bug' }).where(eq(topics.id, state.topicId));

    expect((await state.jobOf(state.asMember)).topicTitle).toBe('Fix the login bug');
  });

  it('hides the topic from other members, admins included', async () => {
    const state = await runningReply();
    await db.update(topics).set({ title: 'Fix the login bug' }).where(eq(topics.id, state.topicId));

    expect(await state.jobTopic(state.asOwner)).toBeUndefined();
    expect(await state.jobOf(state.asOwner)).not.toHaveProperty('topicTitle');
  });

  it('drops the link once the topic is trashed', async () => {
    const state = await runningReply();
    await db
      .update(topics)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(topics.id, state.topicId));

    expect(await state.jobTopic(state.asMember)).toBeUndefined();
  });
});
