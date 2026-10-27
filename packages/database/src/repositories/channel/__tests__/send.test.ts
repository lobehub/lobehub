// @vitest-environment node
import { CHANNEL_LIMITS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMessages, channelThreads, messages, topics } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { createChannelFixture, jobsOf } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-send');

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('ChannelRepository.send', () => {
  it('stores public content independently of ordinary messages and topics', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const input = { content: 'Public', requestKey: 'public', routing: 'fallback' as const };
    const first = await asMember.send(channel.id, input);
    expect(await asMember.send(channel.id, input)).toEqual(first);
    expect(await db.select().from(channelMessages).where(eq(channelMessages.id, first.id))).toEqual(
      [first],
    );
    expect(await db.select().from(messages).where(eq(messages.id, first.id))).toEqual([]);
    expect(
      await db.select().from(topics).where(eq(topics.workspaceId, fixture.workspaceId)),
    ).toEqual([]);
  });

  it('queues a job per mentioned Agent, on behalf of the sender', async () => {
    const { asMember, channel, member } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Coder');
    await fixture.addAgent(channel.id, 'Reviewer');

    const message = await asMember.send(channel.id, {
      content: 'Fix the bug',
      mentions: [coder.id],
      requestKey: 'req-1',
      routing: 'jev',
    });

    expect(message).toMatchObject({
      agentId: null,
      userId: fixture.memberId,
      recipientMemberIds: [coder.id],
      routingSource: 'explicit',
      routingStatus: 'directed',
      sequence: 1,
    });
    const jobs = await jobsOf(db, message.id);
    expect(jobs).toEqual([
      expect.objectContaining({
        memberId: coder.id,
        requesterMemberId: member.id,
        status: 'queued',
      }),
    ]);
  });

  it('wakes no Agent when only people are mentioned', async () => {
    const { asMember, channel, owner } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');

    const message = await asMember.send(channel.id, {
      content: 'Can you review this?',
      mentions: [owner.id],
      requestKey: 'req-1',
      routing: 'jev',
    });

    expect(message).toMatchObject({ recipientMemberIds: [], routingStatus: 'directed' });
    expect(await jobsOf(db, message.id)).toEqual([]);
  });

  it('leaves an unmentioned message to Jev, or to every Agent without a decision model', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Coder');
    const reviewer = await fixture.addAgent(channel.id, 'Reviewer');

    const routed = await asMember.send(channel.id, {
      content: 'Anyone?',
      requestKey: 'req-1',
      routing: 'jev',
    });
    expect(routed).toMatchObject({ routingAttempt: 1, routingStatus: 'pending' });
    expect(await jobsOf(db, routed.id)).toEqual([]);

    const broadcast = await asMember.send(channel.id, {
      content: 'Everyone?',
      requestKey: 'req-2',
      routing: 'fallback',
    });
    expect(broadcast).toMatchObject({ routingSource: 'fallback', routingStatus: 'assigned' });
    expect(broadcast.recipientMemberIds.sort()).toEqual([coder.id, reviewer.id].sort());
    expect(await jobsOf(db, broadcast.id)).toHaveLength(2);
  });

  it('skips routing when no Agent can answer', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();

    const message = await asMember.send(channel.id, {
      content: 'Hello',
      requestKey: 'req-1',
      routing: 'jev',
    });

    expect(message.routingStatus).toBe('skipped');
  });

  it('routes inside a Thread to its followers and lets mentions join it', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Coder');
    const reviewer = await fixture.addAgent(channel.id, 'Reviewer');
    const root = await asMember.send(channel.id, {
      content: 'Root',
      mentions: [coder.id],
      requestKey: 'root',
      routing: 'jev',
    });
    const [thread] = await db
      .insert(channelThreads)
      .values({
        channelId: channel.id,
        followerMemberIds: [coder.id],
        rootMessageId: root.id,
        rootSequence: root.sequence,
      })
      .returning();

    const followUp = await asMember.send(channel.id, {
      content: 'More',
      requestKey: 'follow-up',
      routing: 'fallback',
      threadId: thread.id,
    });
    expect(followUp.recipientMemberIds).toEqual([coder.id]);

    await asMember.send(channel.id, {
      content: 'Join us',
      mentions: [reviewer.id.toUpperCase(), reviewer.id],
      requestKey: 'join',
      routing: 'jev',
      threadId: thread.id,
    });
    const [joined] = await db.select().from(channelThreads).where(eq(channelThreads.id, thread.id));
    expect(joined.followerMemberIds).toEqual([coder.id, reviewer.id]);

    const next = await asMember.send(channel.id, {
      content: 'Everyone here',
      requestKey: 'after-join',
      routing: 'fallback',
      threadId: thread.id,
    });
    expect(next.recipientMemberIds.sort()).toEqual([coder.id, reviewer.id].sort());
  });

  it('returns the original message on retry and rejects a reused retry key', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(channel.id, 'Coder');
    const input = {
      content: 'Once',
      mentions: [coder.id.toUpperCase(), coder.id],
      requestKey: 'req-1',
      routing: 'jev' as const,
    };

    const first = await asMember.send(channel.id, input);
    expect(first.mentions).toEqual([coder.id]);
    const retried = await asMember.send(channel.id, { ...input, mentions: [coder.id] });
    expect(retried.id).toBe(first.id);

    await expect(
      asMember.send(channel.id, { ...input, content: 'Different' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(asOwner.send(channel.id, input)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects empty or oversized content, unknown mentions and foreign files', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const base = { requestKey: 'req-1', routing: 'jev' as const };

    await expect(asMember.send(channel.id, { ...base, content: '  ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      asMember.send(channel.id, {
        ...base,
        content: 'x'.repeat(CHANNEL_LIMITS.contentLength + 1),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const mention of ['not-a-uuid', '00000000-0000-4000-8000-000000000001']) {
      await expect(
        asMember.send(channel.id, { ...base, content: 'Hi', mentions: [mention] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(
      asMember.send(channel.id, { ...base, content: 'Hi', fileIds: ['file_missing'] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
