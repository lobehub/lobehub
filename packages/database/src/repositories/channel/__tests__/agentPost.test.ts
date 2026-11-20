// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelJobs, channelMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-agent-post');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('ChannelRepository.postAgentMessage', () => {
  it('posts as the Agent, answering no request and waking no one, once per key', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const secretary = await fixture.addAgent(channel.id, 'Secretary');
    const post = {
      agentId: secretary.agentId!,
      content: '3 mails need you today.',
      metadata: { source: 'agent-inbox' },
      requestKey: 'agent-inbox:op_1',
    };

    const message = await asOwner.postAgentMessage(channel.id, post);
    expect(message).toMatchObject({
      agentId: secretary.agentId,
      content: '3 mails need you today.',
      metadata: { source: 'agent-inbox' },
      replyToId: null,
      routingStatus: 'reply',
      userId: null,
    });
    expect(
      await db.select().from(channelJobs).where(eq(channelJobs.channelId, channel.id)),
    ).toEqual([]);

    // A redelivered completion finds the post already there.
    expect((await asOwner.postAgentMessage(channel.id, post)).id).toBe(message.id);

    const { messages } = await asOwner.detail(channel.id);
    expect(messages.filter((item) => item.id === message.id)).toEqual([
      expect.objectContaining({ author: expect.objectContaining({ type: 'agent' }) }),
    ]);
  });

  it('refuses an Agent that is not an active member, and a caller who is not one', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const secretary = await fixture.addAgent(channel.id, 'Secretary');
    const post = { agentId: secretary.agentId!, content: 'hi', requestKey: 'k' };

    await db
      .update(channelMembers)
      .set({ status: 'removed' })
      .where(eq(channelMembers.id, secretary.id));
    await expect(asOwner.postAgentMessage(channel.id, post)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const stranger = new ChannelRepository(db, 'nobody', fixture.workspaceId);
    await expect(stranger.postAgentMessage(channel.id, post)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
