// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, assert, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  channelAudit,
  channelMembers,
  channelMessages,
  channels,
  channelThreads,
  workspaceMembers,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelExecutionRepository, ChannelRoutingRepository } from '..';
import { createChannelFixture, jobsOf } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-jev-input');
const routing = new ChannelRoutingRepository(db);
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({
      userId: fixture.memberId,
      workspaceId: fixture.workspaceId,
      role: 'member',
    })
    .onConflictDoNothing();
});
afterEach(fixture.cleanup);

const prepare = async () => {
  const team = await fixture.createTeamChannel();
  const coder = await fixture.addAgent(team.channel.id, 'Coder');
  const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
  const message = await team.asMember.send(team.channel.id, {
    content: 'Implement a parser',
    requestKey: 'request',
    routing: 'jev',
  });
  return { ...team, coder, reviewer, message };
};

describe('Channel routing input and lease', () => {
  it('leases each attempt once and applies its result exactly once', async () => {
    const { channel, coder, message } = await prepare();
    const input = await routing.claim(channel.id, message.id);
    assert(input?.status === 'claimed');
    expect(input).toMatchObject({
      attempt: 1,
      userId: fixture.memberId,
      workspaceId: fixture.workspaceId,
      message: 'Implement a parser',
    });
    expect(input.candidates.map((item) => item.memberId)).toContain(coder.id);
    expect(await routing.claim(channel.id, message.id)).toBeNull();
    const decision = { memberIds: [coder.id], status: 'assigned' as const, reason: 'Fits' };
    expect(await execution.resolveRouting(channel.id, message.id, 1, decision)).toBe(true);
    expect(await execution.resolveRouting(channel.id, message.id, 1, decision)).toBe(false);
    expect(await jobsOf(db, message.id)).toHaveLength(1);
    expect(await routing.pending(channel.id)).toEqual([]);
  });

  it('sends nothing to the model once the channel or the thread is archived', async () => {
    const { asMember, channel, coder, message } = await prepare();
    await db.update(channels).set({ status: 'archived' }).where(eq(channels.id, channel.id));
    expect(await routing.claim(channel.id, message.id)).toBeNull();
    await db.update(channels).set({ status: 'active' }).where(eq(channels.id, channel.id));

    await execution.resolveRouting(channel.id, message.id, 1, {
      reason: 'Nobody',
      status: 'unassigned',
    });
    const thread = await asMember.createThread(channel.id, {
      followerMemberIds: [coder.id],
      rootMessageId: message.id,
    });
    const reply = await asMember.send(channel.id, {
      content: 'Follow-up',
      requestKey: 'thread-request',
      routing: 'jev',
      threadId: thread.id,
    });
    expect(reply.routingStatus).toBe('pending');
    await db
      .update(channelThreads)
      .set({ status: 'archived' })
      .where(eq(channelThreads.id, thread.id));
    expect(await routing.claim(channel.id, reply.id)).toEqual({ status: 'settled' });
    const [settled] = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.id, reply.id));
    expect(settled).toMatchObject({
      routingReason: 'The thread is archived',
      routingStatus: 'unassigned',
    });
  });

  it('recovers expired leases with a new fencing token and discards late answers', async () => {
    const { channel, coder, message } = await prepare();
    await routing.claim(channel.id, message.id);
    await db
      .update(channelAudit)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(and(eq(channelAudit.targetId, message.id), eq(channelAudit.event, 'routing_started')));
    expect(await routing.claim(channel.id, message.id)).toMatchObject({ attempt: 2 });
    expect(
      await execution.resolveRouting(channel.id, message.id, 1, {
        memberIds: [coder.id],
        reason: 'Late',
        status: 'assigned',
      }),
    ).toBe(false);
    expect(await jobsOf(db, message.id)).toEqual([]);
  });

  it('does not route replies, directed messages, or a stopped attempt', async () => {
    const { asMember, asOwner, channel, coder, message } = await prepare();
    const directed = await asMember.send(channel.id, {
      content: '@Coder',
      mentions: [coder.id],
      requestKey: 'directed',
      routing: 'jev',
    });
    expect(await routing.claim(channel.id, directed.id)).toBeNull();
    await routing.claim(channel.id, message.id);
    await asOwner.stop(channel.id, { threadId: null });
    expect(await routing.claim(channel.id, message.id)).toBeNull();
    expect(
      await execution.resolveRouting(channel.id, message.id, 1, {
        memberIds: [coder.id],
        reason: 'Late',
        status: 'assigned',
      }),
    ).toBe(false);
  });

  it('does not read a message from another Channel', async () => {
    const { message } = await prepare();
    const other = await fixture.createTeamChannel('Other');
    expect(await routing.claim(other.channel.id, message.id)).toBeNull();
  });

  it('excludes private, deleted and inactive agents from model-visible candidates', async () => {
    const { channel, coder, reviewer, message } = await prepare();
    const inactive = await fixture.addAgent(channel.id, 'Inactive');
    await db.update(agents).set({ visibility: 'private' }).where(eq(agents.id, coder.agentId!));
    await db.update(agents).set({ isDeleted: true }).where(eq(agents.id, reviewer.agentId!));
    await db
      .update(channelMembers)
      .set({ status: 'left' })
      .where(eq(channelMembers.id, inactive.id));
    const input = await routing.claim(channel.id, message.id);
    assert(input?.status === 'claimed');
    expect(input.candidates).toEqual([]);
  });

  it.each(['channel', 'workspace'])(
    'does not send context to a model after the requester leaves %s',
    async (scope) => {
      const { channel, member, message } = await prepare();
      if (scope === 'channel')
        await db
          .update(channelMembers)
          .set({ status: 'left' })
          .where(eq(channelMembers.id, member.id));
      else
        await db
          .update(workspaceMembers)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(workspaceMembers.workspaceId, fixture.workspaceId),
              eq(workspaceMembers.userId, fixture.memberId),
            ),
          );
      expect(await routing.claim(channel.id, message.id)).toEqual({ status: 'settled' });
      const [current] = await db
        .select()
        .from(channelMessages)
        .where(eq(channelMessages.id, message.id));
      expect(current.routingStatus).toBe('unassigned');
    },
  );

  it('limits context to the requested Thread, its main prefix and the message cutoff', async () => {
    const { asMember, channel, coder, reviewer, message: root } = await prepare();
    const thread = await asMember.createThread(channel.id, {
      rootMessageId: root.id,
      followerMemberIds: [coder.id],
    });
    await execution.resolveRouting(channel.id, root.id, 1, {
      memberIds: [coder.id],
      reason: 'Selected',
      status: 'assigned',
    });
    const otherRoot = await asMember.send(channel.id, {
      content: 'Other topic',
      requestKey: 'other-root',
      routing: 'fallback',
    });
    const other = await db
      .insert(channelThreads)
      .values({
        channelId: channel.id,
        rootMessageId: otherRoot.id,
        rootSequence: otherRoot.sequence,
        followerMemberIds: [reviewer.id],
      })
      .returning();
    await asMember.send(channel.id, {
      content: 'SIBLING SECRET',
      requestKey: 'sibling',
      routing: 'fallback',
      threadId: other[0].id,
    });
    await asMember.send(channel.id, {
      content: 'LATER MAIN',
      requestKey: 'main',
      routing: 'fallback',
    });
    const request = await asMember.send(channel.id, {
      content: 'Continue the parser',
      requestKey: 'thread',
      routing: 'jev',
      threadId: thread.id,
    });
    await asMember.send(channel.id, {
      content: 'FUTURE',
      requestKey: 'future',
      routing: 'fallback',
      threadId: thread.id,
    });
    const input = await routing.claim(channel.id, request.id);
    assert(input?.status === 'claimed');
    expect(input.candidates.map((candidate) => candidate.memberId)).toEqual([coder.id]);
    expect(input.history.map((item) => item.content)).toEqual(['Implement a parser']);
  });

  it('bounds history and uses the agent description when a member has no routing description', async () => {
    const { asMember, channel, coder } = await prepare();
    await db
      .update(agents)
      .set({ description: 'Owns parsers' })
      .where(eq(agents.id, coder.agentId!));
    for (let i = 0; i < 22; i++)
      await asMember.send(channel.id, {
        content: 'x'.repeat(2000),
        requestKey: 'history-' + i,
        routing: 'fallback',
      });
    const message = await asMember.send(channel.id, {
      content: 'Now',
      requestKey: 'latest',
      routing: 'jev',
    });
    const input = await routing.claim(channel.id, message.id);
    assert(input?.status === 'claimed');
    expect(input.history).toHaveLength(20);
    expect(input.history.every((item) => item.content.length <= 1500)).toBe(true);
    expect(input.candidates.find((item) => item.memberId === coder.id)?.description).toBe(
      'Owns parsers',
    );
  });
});
