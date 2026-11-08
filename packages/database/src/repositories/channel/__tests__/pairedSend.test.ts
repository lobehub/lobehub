// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelThreads } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelRepository } from '..';
import { createChannelFixture, jobsOf } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-paired-send');

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** A workspace group with only its owner as a person. */
const createPairedChannel = async () => {
  const asOwner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel, member: owner } = await asOwner.create({ title: 'Pair' });
  return { asOwner, channel, owner };
};

describe('ChannelRepository.send with one person and one Agent', () => {
  it('sends an unmentioned main-channel message straight to the Agent without a decision', async () => {
    const { asOwner, channel, owner } = await createPairedChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');

    const message = await asOwner.send(channel.id, {
      content: 'Anyone?',
      requestKey: 'req-1',
      routing: 'decision',
    });

    expect(message).toMatchObject({
      recipientMemberIds: [agent.id],
      routingAttempt: 0,
      routingSource: 'explicit',
      routingStatus: 'directed',
    });
    expect(await jobsOf(db, message.id)).toEqual([
      expect.objectContaining({ memberId: agent.id, requesterMemberId: owner.id }),
    ]);
  });

  it('wakes the Agent even when the message mentions only the person', async () => {
    const { asOwner, channel, owner } = await createPairedChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');

    const message = await asOwner.send(channel.id, {
      content: 'Note to self',
      mentions: [owner.id],
      requestKey: 'req-1',
      routing: 'decision',
    });

    expect(message).toMatchObject({ recipientMemberIds: [agent.id], routingStatus: 'directed' });
    expect(await jobsOf(db, message.id)).toHaveLength(1);
  });

  it('answers in a Thread the Agent did not follow, and makes it a follower', async () => {
    const { asOwner, channel } = await createPairedChannel();
    // Sent before the Agent joined, so the branch starts without any followers.
    const root = await asOwner.send(channel.id, {
      content: 'Root',
      requestKey: 'root',
      routing: 'decision',
    });
    expect(root.routingStatus).toBe('skipped');
    const agent = await fixture.addAgent(channel.id, 'Coder');

    const reply = await asOwner.send(channel.id, {
      content: 'Continue here',
      requestKey: 'thread-1',
      rootMessageId: root.id,
      routing: 'decision',
    });

    expect(reply).toMatchObject({ recipientMemberIds: [agent.id], routingStatus: 'directed' });
    expect(await jobsOf(db, reply.id)).toEqual([
      expect.objectContaining({ memberId: agent.id, threadId: reply.threadId }),
    ]);
    const [thread] = await db
      .select()
      .from(channelThreads)
      .where(eq(channelThreads.id, reply.threadId!));
    expect(thread.followerMemberIds).toEqual([agent.id]);
  });

  it('keeps routing once a second person or Agent joins', async () => {
    const { asOwner, channel } = await createPairedChannel();
    await fixture.addAgent(channel.id, 'Coder');
    await fixture.addAgent(channel.id, 'Reviewer');
    const twoAgents = await asOwner.send(channel.id, {
      content: 'Anyone?',
      requestKey: 'req-1',
      routing: 'decision',
    });
    expect(twoAgents).toMatchObject({ recipientMemberIds: [], routingStatus: 'pending' });

    const team = await fixture.createTeamChannel('Team');
    await fixture.addAgent(team.channel.id, 'Coder');
    const twoPeople = await team.asOwner.send(team.channel.id, {
      content: 'Anyone?',
      requestKey: 'req-1',
      routing: 'decision',
    });
    expect(twoPeople).toMatchObject({ recipientMemberIds: [], routingStatus: 'pending' });
  });
});
