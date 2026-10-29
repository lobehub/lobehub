// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers, channelThreads, topics } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-continuation');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async (thread = false) => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Agent');
  let threadId: string | undefined;
  if (thread) {
    const root = await team.asMember.send(team.channel.id, {
      content: 'Thread root',
      mentions: [team.owner.id],
      requestKey: 'root',
      routing: 'fallback',
    });
    const [created] = await db
      .insert(channelThreads)
      .values({
        channelId: team.channel.id,
        rootMessageId: root.id,
        rootSequence: root.sequence,
        followerMemberIds: [agent.id],
      })
      .returning();
    threadId = created.id;
  }
  let sequence = 0;
  const send = async () => {
    const content = `Request ${++sequence}`;
    const message = await team.asMember.send(team.channel.id, {
      content,
      mentions: [agent.id],
      requestKey: content,
      routing: 'fallback',
      threadId,
    });
    return (await jobsOf(db, message.id))[0];
  };
  const claim = (id: string) => execution.claim(team.channel.id, id, lease);
  const finish = async (id: string, publish = true) => {
    await execution.accepted(team.channel.id, id);
    await execution.saveDraft(team.channel.id, id, `Answer ${sequence}`);
    if (publish) await execution.publish(team.channel.id, id);
    await execution.releaseWriter(team.channel.id, id);
  };
  const input = async (id: string) =>
    (await execution.input(team.channel.id, id)).map((m) => m.content);
  return { ...team, agent, claim, finish, input, send };
};

describe('Channel topic continuation', () => {
  it.each([
    { hours: 3, thread: false, reuse: true },
    { hours: 5, thread: false, reuse: false },
    { hours: 5, thread: true, reuse: true },
  ])(
    'checks idle expiry on the next request: $hours hours, Thread=$thread',
    async ({ hours, thread, reuse }) => {
      const state = await setup(thread);
      const first = (await state.claim((await state.send()).id))!;
      await state.finish(first.job.id);
      await db
        .update(topics)
        .set({ updatedAt: new Date(Date.now() - hours * 60 * 60 * 1000) })
        .where(eq(topics.id, first.topic.id));
      const second = (await state.claim((await state.send()).id))!;
      expect(second.topic.id === first.topic.id).toBe(reuse);
      expect(second.job.operationId).not.toBe(first.job.operationId);
      expect(second.job.topicId).toBe(second.topic.id);
      expect(await state.input(second.job.id)).toEqual(['Request 2']);
      expect(await db.select().from(topics).where(eq(topics.id, first.topic.id))).toHaveLength(1);
    },
  );

  it.each(['environment', 'config', 'agent', 'trashed', 'failed', 'unknown'])(
    'starts a new topic after %s changes the continuation boundary',
    async (reason) => {
      const state = await setup();
      const first = (await state.claim((await state.send()).id))!;
      if (reason === 'failed') {
        await execution.fail(state.channel.id, first.job.id, { message: 'Failed' });
        await execution.releaseWriter(state.channel.id, first.job.id);
      } else if (reason === 'unknown') {
        await execution.executionUnknown(state.channel.id, first.job.id, 'Dispatch unknown');
        await execution.isolate(state.channel.id, first.job.id, 'Unconfirmed');
      } else {
        await state.finish(first.job.id);
      }
      if (reason === 'environment')
        await db
          .update(channelMembers)
          .set({
            config: {
              ...state.agent.config,
              deviceId: 'device-1',
              workingDirectory: '/different-repo',
            },
          })
          .where(eq(channelMembers.id, state.agent.id));
      if (reason === 'config')
        await db
          .update(agents)
          .set({ model: 'changed' })
          .where(eq(agents.id, state.agent.agentId!));
      if (reason === 'agent') {
        const [source] = await db
          .insert(agents)
          .values({ userId: fixture.ownerId, workspaceId: fixture.workspaceId })
          .returning();
        await db
          .update(channelMembers)
          .set({ agentId: source.id })
          .where(eq(channelMembers.id, state.agent.id));
      }
      if (reason === 'trashed')
        await db
          .update(topics)
          .set({ isDeleted: true, deletedAt: new Date() })
          .where(eq(topics.id, first.topic.id));
      const second = (await state.claim((await state.send()).id))!;
      expect(second.topic.id).not.toBe(first.topic.id);
    },
  );

  it('delivers only each request when continuing across delayed publications', async () => {
    const state = await setup();
    const first = (await state.claim((await state.send()).id))!;
    const next = await state.send();
    await state.finish(first.job.id, false);
    const second = (await state.claim(next.id))!;
    expect(second.topic.id).toBe(first.topic.id);
    await execution.publish(state.channel.id, first.job.id);
    expect(await state.input(second.job.id)).toEqual(['Request 2']);
    await state.finish(second.job.id);
    const third = (await state.claim((await state.send()).id))!;
    expect(await state.input(third.job.id)).toEqual(['Request 3']);
  });

  it('starts a new topic when failed routing is explicitly retried after a newer delivery', async () => {
    const state = await setup();
    const early = await state.asMember.send(state.channel.id, {
      content: 'Delayed request',
      requestKey: 'delayed',
      routing: 'decision',
    });
    await execution.resolveRouting(state.channel.id, early.id, early.routingAttempt, {
      reason: 'Decision unavailable',
      status: 'unassigned',
    });
    const first = (await state.claim((await state.send()).id))!;
    await state.finish(first.job.id);
    const retried = await state.asMember.retryRouting(state.channel.id, early.id);
    await execution.resolveRouting(state.channel.id, early.id, retried.routingAttempt, {
      memberIds: [state.agent.id],
      reason: 'Agent can help',
      status: 'assigned',
    });
    const [delayedJob] = await jobsOf(db, early.id);
    const delayed = (await state.claim(delayedJob.id))!;
    expect(delayed.topic.id).not.toBe(first.topic.id);
    await state.finish(delayed.job.id);
    const next = (await state.claim((await state.send()).id))!;
    expect(next.topic.id).toBe(delayed.topic.id);
    expect(await state.input(next.job.id)).toEqual(['Request 2']);
  });

  it('cancels a deleted Agent reference while retaining the public request', async () => {
    const state = await setup();
    const job = await state.send();
    await db.delete(agents).where(eq(agents.id, state.agent.agentId!));
    expect(await state.claim(job.id)).toBeNull();
    expect((await jobsOf(db, job.messageId))[0]).toMatchObject({
      blockedCode: null,
      status: 'cancelled',
      topicId: null,
    });
  });
});
