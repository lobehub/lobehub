// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentOperations,
  channelJobs,
  channelMembers,
  channels,
  channelThreads,
  messages,
  workspaceMembers,
} from '../../../schemas';
import { ChannelExecutionRepository, ChannelHistoryRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-history');
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
  const agent = await fixture.addAgent(team.channel.id, 'Reader');
  let key = 0;
  const say = (content: string, threadId?: string) =>
    team.asMember.send(team.channel.id, {
      content,
      threadId,
      mentions: [team.owner.id],
      requestKey: `history-${++key}`,
      routing: 'decision',
    });
  const run = async (threadId?: string) => {
    const request = await team.asMember.send(team.channel.id, {
      content: 'What did everyone decide?',
      threadId,
      mentions: [agent.id],
      requestKey: `run-${++key}`,
      routing: 'decision',
    });
    const [job] = await jobsOf(db, request.id);
    const claim = (await execution.claim(team.channel.id, job.id, lease))!;
    await db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(eq(agentOperations.id, claim.job.operationId!));
    return { claim, request, operationId: claim.job.operationId! };
  };
  return {
    ...team,
    agent,
    say,
    run,
    history: new ChannelHistoryRepository(db, fixture.memberId, fixture.workspaceId),
  };
};

describe('Channel on-demand history', () => {
  it('delivers only the request and pages attributed public history up to the frozen cutoff', async () => {
    const state = await setup();
    const first = await state.say('Earlier decision');
    const second = await state.say('Budget: 20');
    const { claim, request, operationId } = await state.run();
    await state.say('LATER secret');
    await db.insert(messages).values({
      userId: fixture.memberId,
      topicId: claim.topic.id,
      role: 'assistant',
      content: 'PRIVATE reasoning',
    });
    expect((await execution.input(state.channel.id, claim.job.id)).map((m) => m.id)).toEqual([
      request.id,
    ]);
    const page = await state.history.readMessages(operationId, { limit: 2 });
    expect(page.messages.map((m) => m.id)).toEqual([second.id, request.id]);
    expect(page.messages[0].author).toEqual({ id: fixture.memberId, name: 'mia', type: 'user' });
    expect(page.nextBeforeSequence).toBe(second.sequence);
    const older = await state.history.readMessages(operationId, {
      beforeSequence: page.nextBeforeSequence!,
      limit: 2,
    });
    expect(older.messages.map((m) => m.id)).toEqual([first.id]);
    expect(older.nextBeforeSequence).toBeNull();
    expect(JSON.stringify([page, older])).not.toMatch(/LATER|PRIVATE/);
  });

  it('reads only the thread and its parent prefix, rejecting sibling and later main-channel messages', async () => {
    const state = await setup();
    const root = await state.say('Root');
    const otherRoot = await state.say('Other thread root');
    const [thread, sibling] = await db
      .insert(channelThreads)
      .values(
        [root, otherRoot].map((r) => ({
          channelId: state.channel.id,
          rootMessageId: r.id,
          rootSequence: r.sequence,
        })),
      )
      .returning();
    const other = await state.say('Sibling', sibling.id);
    const later = await state.say('Main after root');
    const branch = await state.say('Branch decision', thread.id);
    const { operationId, request } = await state.run(thread.id);
    expect((await state.history.readMessages(operationId)).messages.map((m) => m.id)).toEqual([
      root.id,
      branch.id,
      request.id,
    ]);
    for (const messageId of [other.id, later.id])
      await expect(state.history.readMessage(operationId, { messageId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
  });

  it('reads earlier history and published answers when continuing the private topic', async () => {
    const state = await setup();
    const old = await state.say('A decision before the previous request');
    const first = await state.run();
    await execution.accepted(state.channel.id, first.claim.job.id);
    await execution.saveDraft(state.channel.id, first.claim.job.id, 'Previous answer');
    const answerId = await execution.publish(state.channel.id, first.claim.job.id);
    await execution.releaseWriter(state.channel.id, first.claim.job.id);

    const next = await state.run();
    expect(next.claim.topic.id).toBe(first.claim.topic.id);
    expect((await state.history.readMessages(next.operationId)).messages.map((m) => m.id)).toEqual([
      old.id,
      first.request.id,
      answerId,
      next.request.id,
    ]);
  });

  it('bounds excerpts and lets callers read every character without silent truncation', async () => {
    const state = await setup();
    const text = 'a'.repeat(24_010) + 'THE END';
    const old = await state.say(text);
    const { operationId } = await state.run();
    const preview = (await state.history.readMessages(operationId)).messages[0];
    expect(preview.content).toHaveLength(2000);
    expect(preview.truncated).toBe(true);
    let offset: number | null = 0;
    let actual = '';
    do {
      const result = await state.history.readMessage(operationId, { messageId: old.id, offset });
      expect(result.message.content.length).toBeLessThanOrEqual(12_000);
      actual += result.message.content;
      offset = result.nextOffset;
    } while (offset !== null);
    expect(actual).toBe(text);
  });

  it('rejects another user, another scope, unknown operations and foreign messages', async () => {
    const state = await setup();
    const foreign = await setup();
    const message = await foreign.say('Other channel');
    const { operationId } = await state.run();
    await expect(
      new ChannelHistoryRepository(db, fixture.ownerId, fixture.workspaceId).readMessages(
        operationId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      new ChannelHistoryRepository(db, fixture.memberId).readMessages(operationId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(state.history.readMessages('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      state.history.readMessage(operationId, { messageId: message.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    'requester',
    'agent',
    'workspace',
    'revoked',
    'terminal',
    'thread',
    'archived channel',
    'archived thread',
  ])('rechecks %s authority on every read', async (change) => {
    const state = await setup();
    const root = await state.say('Root');
    const [thread] = await db
      .insert(channelThreads)
      .values({
        channelId: state.channel.id,
        rootMessageId: root.id,
        rootSequence: root.sequence,
      })
      .returning();
    const { operationId, claim } = await state.run(thread.id);
    await expect(state.history.readMessages(operationId)).resolves.toBeDefined();
    if (change === 'requester' || change === 'agent')
      await db
        .update(channelMembers)
        .set({ status: 'left' })
        .where(eq(channelMembers.id, change === 'agent' ? state.agent.id : state.member.id));
    if (change === 'workspace')
      await db
        .update(workspaceMembers)
        .set({ deletedAt: new Date() })
        .where(eq(workspaceMembers.userId, fixture.memberId));
    if (change === 'revoked')
      await db
        .update(channelJobs)
        .set({ publicationRevoked: true })
        .where(eq(channelJobs.id, claim.job.id));
    if (change === 'terminal')
      await db
        .update(agentOperations)
        .set({ status: 'done' })
        .where(eq(agentOperations.id, operationId));
    if (change === 'thread')
      await db
        .update(channelThreads)
        .set({ deletedAt: new Date(), isDeleted: true })
        .where(eq(channelThreads.id, thread.id));
    if (change === 'archived channel')
      await db
        .update(channels)
        .set({ status: 'archived' })
        .where(eq(channels.id, state.channel.id));
    if (change === 'archived thread')
      await db
        .update(channelThreads)
        .set({ status: 'archived' })
        .where(eq(channelThreads.id, thread.id));
    await expect(state.history.readMessages(operationId)).rejects.toThrow();
  });

  it.each([{ limit: 0 }, { limit: 21 }, { limit: 1.5 }, { beforeSequence: -1 }])(
    'rejects invalid paging %j',
    async (params) => {
      const state = await setup();
      const { operationId } = await state.run();
      await expect(state.history.readMessages(operationId, params)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    },
  );
});
