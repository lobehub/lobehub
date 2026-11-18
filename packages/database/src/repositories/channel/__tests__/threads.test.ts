// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, channelJobs, messages, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelHistoryRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-threads');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.memberId });
});
afterEach(fixture.cleanup);

const setup = async () => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Worker');
  let key = 0;
  const say = (content: string, options: { rootMessageId?: string; threadId?: string } = {}) =>
    team.asMember.send(team.channel.id, {
      content,
      mentions: [team.owner.id],
      requestKey: `threads-${++key}`,
      routing: 'decision',
      ...options,
    });
  /** The Agent's reply to a request in a branch, claimed and running. */
  const run = async (options: { rootMessageId?: string; threadId?: string } = {}) => {
    const request = await team.asMember.send(team.channel.id, {
      content: `Task ${++key}`,
      mentions: [agent.id],
      requestKey: `run-${key}`,
      routing: 'decision',
      ...options,
    });
    const [job] = await jobsOf(db, request.id);
    const claim = (await execution.claim(team.channel.id, job.id, lease))!;
    await db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(eq(agentOperations.id, claim.job.operationId!));
    return { claim, operationId: claim.job.operationId!, request, threadId: request.threadId };
  };
  return {
    ...team,
    agent,
    history: new ChannelHistoryRepository(db, fixture.memberId, fixture.workspaceId),
    run,
    say,
  };
};

describe('Channel Threads from a run', () => {
  it('lists Threads with the Agent’s reply in each and the running reply’s latest steps', async () => {
    const state = await setup();
    const rootA = await state.say('Write the report');
    const rootB = await state.say('Fix the login bug');
    const a = await state.run({ rootMessageId: rootA.id });
    const b = await state.run({ rootMessageId: rootB.id });
    await db
      .update(channelJobs)
      .set({ status: 'completed' })
      .where(eq(channelJobs.id, b.claim.job.id));
    await db.insert(messages).values({
      content: 'Drafting section two',
      role: 'assistant',
      tools: [{ apiName: 'search', identifier: 'lobe-web-browsing' }],
      topicId: a.claim.topic.id,
      userId: fixture.memberId,
    });
    const main = await state.run();

    const page = await state.history.listThreads(main.operationId);
    expect(page.threads.map((thread) => thread.root)).toEqual([
      'Fix the login bug',
      'Write the report',
    ]);
    const [threadB, threadA] = page.threads;
    expect(threadA).toMatchObject({
      current: false,
      lastMessage: { content: a.request.content },
      run: {
        activity: [
          { role: 'assistant', text: 'Drafting section two', tools: ['lobe-web-browsing.search'] },
        ],
        requester: 'your requester',
        status: 'running',
      },
      threadId: a.threadId,
    });
    expect(threadB.run).toMatchObject({ status: 'completed' });
    expect(threadB.run).not.toHaveProperty('activity');

    const active = await state.history.listThreads(main.operationId, { activeOnly: true });
    expect(active.threads.map((thread) => thread.threadId)).toEqual([a.threadId]);
  });

  it('reads another Thread live, past the run’s own cutoff', async () => {
    const state = await setup();
    const root = await state.say('Investigate');
    const work = await state.run({ rootMessageId: root.id });
    const main = await state.run();
    const later = await state.say('Found the cause', { threadId: work.threadId! });
    await state.say('Main after the request');

    const page = await state.history.readMessages(main.operationId, {
      threadId: work.threadId!,
    });
    expect(page.messages.map((m) => m.id)).toEqual([root.id, work.request.id, later.id]);
    expect(page.cutoffSequence).toBe(later.sequence);
  });

  it('targets another Thread with the Agent’s open replies, never the run’s own', async () => {
    const state = await setup();
    const root = await state.say('Long job');
    const work = await state.run({ rootMessageId: root.id });
    const main = await state.run();

    const target = await state.history.threadTarget(main.operationId, work.threadId!);
    expect(target).toMatchObject({
      channelId: state.channel.id,
      relayed: false,
      threadId: work.threadId,
    });
    expect(target.openJobs).toEqual([
      expect.objectContaining({
        id: work.claim.job.id,
        operationId: work.operationId,
        operationStatus: 'running',
        operationUserId: fixture.memberId,
        status: 'running',
      }),
    ]);
    await expect(
      state.history.threadTarget(work.operationId, work.threadId!),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(state.history.threadTarget(main.operationId, 'thd_missing')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
  });

  it('posts a message for the record without waking any Agent', async () => {
    const state = await setup();
    const root = await state.asMember.send(state.channel.id, {
      content: 'Title only',
      requestKey: 'silent-root',
      routing: 'fallback',
      silent: true,
    });
    expect(root).toMatchObject({ recipientMemberIds: [], routingStatus: 'skipped' });
    expect(await jobsOf(db, root.id)).toEqual([]);
    await expect(
      state.asMember.send(state.channel.id, {
        content: 'Nope',
        mentions: [state.agent.id],
        requestKey: 'silent-mention',
        routing: 'fallback',
        silent: true,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
