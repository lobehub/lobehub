// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-job-request');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel job request', () => {
  it('quotes the request a queued or running reply answers', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Agent');
    const request = await team.asMember.send(team.channel.id, {
      content: 'Look into the login bug',
      mentions: [agent.id],
      requestKey: 'question',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, request.id);
    const jobOf = async () =>
      (await team.asOwner.detail(team.channel.id)).jobs.find((entry) => entry.id === job.id)!;

    expect((await jobOf()).request).toMatchObject({
      author: { type: 'user' },
      content: 'Look into the login bug',
      id: request.id,
    });

    await execution.claim(team.channel.id, job.id, lease);
    await execution.accepted(team.channel.id, job.id);
    expect((await jobOf()).request?.id).toBe(request.id);
  });

  it("quotes a Thread's request in the main view, which does not load the Thread", async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Agent');
    const root = await team.asMember.send(team.channel.id, {
      content: 'Root',
      requestKey: 'root',
    });
    const thread = await team.asMember.createThread(team.channel.id, { rootMessageId: root.id });
    const request = await team.asMember.send(team.channel.id, {
      content: 'Follow-up in the thread',
      mentions: [agent.id],
      requestKey: 'thread-question',
      routing: 'fallback',
      threadId: thread.id,
    });
    const [job] = await jobsOf(db, request.id);
    await execution.claim(team.channel.id, job.id, lease);

    const main = await team.asOwner.detail(team.channel.id);
    expect(main.messages.some((message) => message.id === request.id)).toBe(false);
    expect(main.jobs.find((entry) => entry.id === job.id)?.request).toMatchObject({
      content: 'Follow-up in the thread',
      threadId: thread.id,
    });
  });
});
