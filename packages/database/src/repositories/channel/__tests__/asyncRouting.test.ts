// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, assert, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMessages, channelThreads, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRoutingRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-async-routing');
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

const setup = async () => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Agent');
  const other = await fixture.addAgent(team.channel.id, 'Other');
  const root = await team.asMember.send(team.channel.id, {
    content: 'Make a change',
    requestKey: 'root',
    routing: 'jev',
  });
  return { ...team, agent, other, root };
};

const messageById = async (id: string) => {
  const [message] = await db.select().from(channelMessages).where(eq(channelMessages.id, id));
  return message;
};

const finish = async (channelId: string, jobId: string) => {
  await execution.accepted(channelId, jobId);
  await execution.saveDraft(channelId, jobId, 'Done');
  await execution.publish(channelId, jobId);
  await execution.releaseWriter(channelId, jobId);
};

describe('asynchronous Channel routing', () => {
  it('keeps an explicit follow-up behind an earlier leased routing decision and its delivery', async () => {
    const { agent, asMember, channel, root } = await setup();
    expect(await routing.claim(channel.id, root.id)).not.toBeNull();
    const next = await asMember.send(channel.id, {
      content: 'Undo the change',
      mentions: [agent.id],
      requestKey: 'undo',
      routing: 'jev',
    });
    const [nextJob] = await jobsOf(db, next.id);
    expect(await routing.claim(channel.id, root.id)).toBeNull();
    expect(await execution.claim(channel.id, nextJob.id, lease)).toBeNull();
    expect(await jobById(db, nextJob.id)).toMatchObject({
      blockedCode: 'member_busy',
      operationId: null,
      topicId: null,
      writerHeld: false,
    });

    await execution.resolveRouting(channel.id, root.id, 1, {
      memberIds: [agent.id],
      reason: 'Selected',
      status: 'assigned',
    });
    const [firstJob] = await jobsOf(db, root.id);
    expect(await execution.claim(channel.id, nextJob.id, lease)).toBeNull();
    const first = await execution.claim(channel.id, firstJob.id, lease);
    expect(first).not.toBeNull();
    await finish(channel.id, firstJob.id);
    const second = await execution.claim(channel.id, nextJob.id, lease);
    expect(second?.topic.id).toBe(first?.topic.id);
  });

  it.each(['skipped', 'unassigned'] as const)(
    'releases the routing barrier after a %s decision',
    async (status) => {
      const { agent, asMember, channel, root } = await setup();
      const next = await asMember.send(channel.id, {
        content: 'Explicit request',
        mentions: [agent.id],
        requestKey: 'next',
        routing: 'jev',
      });
      const [job] = await jobsOf(db, next.id);
      expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
      await execution.resolveRouting(channel.id, root.id, 1, { reason: 'Settled', status });
      expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
    },
  );

  it('reports claim-time settlement so a blocked job can be retried immediately', async () => {
    const { agent, asOwner, channel, root } = await setup();
    const next = await asOwner.send(channel.id, {
      content: 'Independent request',
      mentions: [agent.id],
      requestKey: 'owner-follow-up',
      routing: 'jev',
    });
    const [job] = await jobsOf(db, next.id);
    expect(await execution.claim(channel.id, job.id, lease)).toBeNull();

    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, fixture.memberId));
    expect(await routing.claim(channel.id, root.id)).toEqual({ status: 'settled' });
    expect(await messageById(root.id)).toMatchObject({ routingStatus: 'unassigned' });
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
    expect(await routing.claim(channel.id, root.id)).toBeNull();
  });

  it('does not block an Agent on a pending branch belonging only to another Agent', async () => {
    const { agent, asMember, channel, other, root } = await setup();
    await execution.resolveRouting(channel.id, root.id, 1, {
      memberIds: [other.id],
      reason: 'Selected',
      status: 'assigned',
    });
    await asMember.send(channel.id, {
      content: 'Other branch',
      rootMessageId: root.id,
      requestKey: 'branch',
      routing: 'jev',
    });
    const next = await asMember.send(channel.id, {
      content: 'Independent',
      mentions: [agent.id],
      requestKey: 'next',
      routing: 'jev',
    });
    const [job] = await jobsOf(db, next.id);
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
  });

  it('waits for an earlier branch decision for a following Agent without blocking other channels', async () => {
    const { agent, asMember, channel, root } = await setup();
    await execution.resolveRouting(channel.id, root.id, 1, {
      memberIds: [agent.id],
      reason: 'Selected',
      status: 'assigned',
    });
    const [rootJob] = await jobsOf(db, root.id);
    await execution.claim(channel.id, rootJob.id, lease);
    await finish(channel.id, rootJob.id);
    const branch = await asMember.send(channel.id, {
      content: 'Earlier branch',
      rootMessageId: root.id,
      requestKey: 'branch',
      routing: 'jev',
    });
    const next = await asMember.send(channel.id, {
      content: 'Later main',
      mentions: [agent.id],
      requestKey: 'main',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, next.id);
    expect(await execution.claim(channel.id, job.id, lease)).toBeNull();
    const otherChannel = await fixture.createTeamChannel('Unrelated');
    const otherAgent = await fixture.addAgent(otherChannel.channel.id, 'Other channel Agent');
    const unrelated = await otherChannel.asMember.send(otherChannel.channel.id, {
      content: 'Independent',
      mentions: [otherAgent.id],
      requestKey: 'independent',
      routing: 'fallback',
    });
    const [unrelatedJob] = await jobsOf(db, unrelated.id);
    expect(await execution.claim(otherChannel.channel.id, unrelatedJob.id, lease)).not.toBeNull();
    await execution.resolveRouting(channel.id, branch.id, 1, {
      reason: 'No response',
      status: 'skipped',
    });
    expect(await execution.claim(channel.id, job.id, lease)).not.toBeNull();
  });

  it.each(['jev', 'fallback'] as const)(
    'keeps the first %s thread reply pending until it can inherit the root responders',
    async (mode) => {
      const { agent, asMember, channel, other, root } = await setup();
      const reply = await asMember.send(channel.id, {
        content: 'Continue here',
        requestKey: 'reply',
        rootMessageId: root.id,
        routing: mode,
      });
      expect(reply.routingStatus).toBe('pending');
      expect(await jobsOf(db, reply.id)).toEqual([]);
      expect(await routing.claim(channel.id, reply.id)).toBeNull();
      // An explicit mention made while the root is routing must survive inheritance.
      await asMember.send(channel.id, {
        content: 'Join us',
        mentions: [other.id],
        requestKey: 'mention',
        routing: mode,
        threadId: reply.threadId,
      });
      await execution.resolveRouting(channel.id, root.id, 1, {
        memberIds: [agent.id],
        reason: 'Selected',
        status: 'assigned',
      });
      const [thread] = await db
        .select()
        .from(channelThreads)
        .where(eq(channelThreads.id, reply.threadId!));
      expect(thread.followerMemberIds.sort()).toEqual([agent.id, other.id].sort());
      const input = await routing.claim(channel.id, reply.id);
      assert(input?.status === 'claimed');
      expect(input.candidates.map((candidate) => candidate.memberId).sort()).toEqual(
        [agent.id, other.id].sort(),
      );
      expect(input.fallback).toBe(mode === 'fallback');
      await execution.resolveRouting(channel.id, reply.id, input.attempt, {
        memberIds: [agent.id],
        reason: 'Follow-up',
        status: 'assigned',
      });
      expect(await messageById(reply.id)).toMatchObject({
        recipientMemberIds: [agent.id],
        routingStatus: 'assigned',
        routingSource: mode === 'fallback' ? 'fallback' : 'jev',
      });
      expect(await jobsOf(db, reply.id)).toHaveLength(1);
      const next = await asMember.send(channel.id, {
        content: 'More',
        requestKey: 'more',
        threadId: thread.id,
        routing: 'fallback',
      });
      expect(next.recipientMemberIds.sort()).toEqual([agent.id, other.id].sort());
    },
  );

  it('does not revive a stopped thread reply when its root finishes routing', async () => {
    const { agent, asMember, asOwner, channel, root } = await setup();
    const reply = await asMember.send(channel.id, {
      content: 'Continue',
      requestKey: 'reply',
      rootMessageId: root.id,
      routing: 'jev',
    });
    expect(reply.routingStatus).toBe('pending');
    await asOwner.stop(channel.id, { threadId: reply.threadId });
    await execution.resolveRouting(channel.id, root.id, 1, {
      memberIds: [agent.id],
      reason: 'Selected',
      status: 'assigned',
    });
    expect(await routing.claim(channel.id, reply.id)).toBeNull();
    expect((await messageById(reply.id)).routingStatus).toBe('unassigned');
    expect(await jobsOf(db, reply.id)).toEqual([]);
  });

  it('keeps a reply retryable when its root routing fails instead of declaring no response needed', async () => {
    const { asMember, channel, root } = await setup();
    const reply = await asMember.send(channel.id, {
      content: 'Continue',
      requestKey: 'reply',
      rootMessageId: root.id,
      routing: 'jev',
    });
    await execution.resolveRouting(channel.id, root.id, 1, {
      reason: 'Provider unavailable',
      status: 'unassigned',
    });
    expect(await routing.claim(channel.id, reply.id)).toEqual({ status: 'settled' });
    expect((await messageById(reply.id)).routingStatus).toBe('unassigned');
    expect(await jobsOf(db, reply.id)).toEqual([]);
  });

  it('inherits a settled root even when a branch was opened without sending a reply yet', async () => {
    const { agent, asMember, channel, root } = await setup();
    const thread = await asMember.createThread(channel.id, { rootMessageId: root.id });
    await execution.resolveRouting(channel.id, root.id, 1, {
      memberIds: [agent.id],
      reason: 'Selected',
      status: 'assigned',
    });
    const reply = await asMember.send(channel.id, {
      content: 'Continue',
      requestKey: 'reply',
      threadId: thread.id,
      routing: 'fallback',
    });
    expect(reply.recipientMemberIds).toEqual([agent.id]);
    expect(await jobsOf(db, reply.id)).toHaveLength(1);
  });

  it('preserves every fallback responder when a deferred branch has more than 21 followers', async () => {
    const { agent, asMember, channel, other, root } = await setup();
    const recipients = [agent.id, other.id];
    for (let i = 0; i < 20; i++) {
      const member = await fixture.addAgent(channel.id, `Agent ${i}`);
      recipients.push(member.id);
    }
    const reply = await asMember.send(channel.id, {
      content: 'All follow up',
      requestKey: 'reply',
      rootMessageId: root.id,
      routing: 'fallback',
    });
    await execution.resolveRouting(channel.id, root.id, 1, {
      memberIds: recipients,
      reason: 'Selected',
      status: 'assigned',
    });
    const input = await routing.claim(channel.id, reply.id);
    assert(input?.status === 'claimed');
    expect(input.candidates.map(({ memberId }) => memberId).sort()).toEqual(recipients.sort());
    await execution.resolveRouting(channel.id, reply.id, input.attempt, {
      memberIds: input.candidates.map(({ memberId }) => memberId),
      reason: 'Fallback',
      status: 'assigned',
    });
    expect(await jobsOf(db, reply.id)).toHaveLength(22);
  });
});
