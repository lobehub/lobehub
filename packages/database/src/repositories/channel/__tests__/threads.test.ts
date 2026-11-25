// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
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

  it('pages older Threads from nextBefore and stops at the last page', async () => {
    const state = await setup();
    for (const title of ['Work 0', 'Work 1', 'Work 2', 'Work 3']) {
      const root = await state.say(title);
      await state.run({ rootMessageId: root.id });
    }
    const main = await state.run();
    const ids = (page: { threads: { threadId: string }[] }) =>
      page.threads.map((thread) => thread.threadId);

    const first = await state.history.listThreads(main.operationId, { limit: 2 });
    expect(first.threads).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    // The cursor is the last Thread of the page, so a repeat call pages from where this one ended.
    expect(first.nextBefore).toBe(first.threads.at(-1)!.threadId);

    const second = await state.history.listThreads(main.operationId, {
      before: first.nextBefore!,
      limit: 2,
    });
    expect(second.threads).toHaveLength(2);
    expect(ids(second).filter((id) => ids(first).includes(id))).toEqual([]);
    expect(second.hasMore).toBe(false);
    expect(second.nextBefore).toBeNull();

    await expect(
      state.history.listThreads(main.operationId, { before: 'cht_missing' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('pages past Threads that share the cursor’s millisecond', async () => {
    const state = await setup();
    const stamped: string[] = [];
    for (const title of ['Work 0', 'Work 1', 'Work 2']) {
      const root = await state.say(title);
      const run = await state.run({ rootMessageId: root.id });
      stamped.push(run.threadId!);
    }
    const main = await state.run();
    // Postgres keeps microseconds while a JS `Date` stops at milliseconds: three Threads stamped
    // inside one millisecond used to make the cursor round down and skip its own bucket.
    const micros = ['00:00:00.123100', '00:00:00.123200', '00:00:00.123300'];
    for (const [index, threadId] of stamped.entries())
      await db.execute(
        sql`update channel_threads set created_at = ${`2026-01-01 ${micros[index]}+00`}::timestamptz where id = ${threadId}`,
      );

    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await state.history.listThreads(main.operationId, { before, limit: 1 });
      seen.push(...result.threads.map((thread) => thread.threadId));
      if (!result.hasMore) break;
      before = result.nextBefore!;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...stamped].sort());
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
    await expect(
      state.history.readMessage(main.operationId, {
        messageId: later.id,
        threadId: work.threadId!,
      }),
    ).resolves.toMatchObject({ message: { content: 'Found the cause' }, nextOffset: null });
    await expect(
      state.history.readMessage(main.operationId, { messageId: later.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
