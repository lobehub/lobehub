// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelJobs } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelRepository } from '..';
import { createChannelFixture, jobsOf } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-mute');

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const createPair = async () => {
  const asOwner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await asOwner.create({ title: 'Pair' });
  return { asOwner, channel };
};

describe('ChannelRepository.setMemberMuted', () => {
  it('leaves a muted paired Agent quiet until it is @mentioned', async () => {
    const { asOwner, channel } = await createPair();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    await asOwner.setMemberMuted(channel.id, agent.id, true);

    const unaddressed = await asOwner.send(channel.id, {
      content: 'Anyone?',
      requestKey: 'req-1',
      routing: 'decision',
    });
    expect(unaddressed).toMatchObject({ recipientMemberIds: [], routingStatus: 'skipped' });
    expect(await jobsOf(db, unaddressed.id)).toEqual([]);

    const mentioned = await asOwner.send(channel.id, {
      content: '@Coder please',
      mentions: [agent.id],
      requestKey: 'req-2',
      routing: 'decision',
    });
    expect(mentioned).toMatchObject({ recipientMemberIds: [agent.id], routingStatus: 'directed' });
  });

  it('keeps a muted Agent out of the all-candidate fallback', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const muted = await fixture.addAgent(channel.id, 'Muted');
    const other = await fixture.addAgent(channel.id, 'Other');
    await asOwner.setMemberMuted(channel.id, muted.id, true);

    const message = await asOwner.send(channel.id, {
      content: 'Who can help?',
      requestKey: 'req-1',
      routing: 'fallback',
    });
    expect(message.recipientMemberIds).toEqual([other.id]);
  });

  it('does not wake a muted Agent for a reply to its message, unless @mentioned', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Secretary');
    const said = await asOwner.postAgentMessage(channel.id, {
      agentId: agent.agentId!,
      content: 'Done.',
      requestKey: 'post-1',
    });
    await asOwner.setMemberMuted(channel.id, agent.id, true);

    const reply = await asOwner.send(channel.id, {
      content: 'Thanks',
      replyToId: said.id,
      requestKey: 'req-1',
      routing: 'decision',
    });
    expect(reply).toMatchObject({ recipientMemberIds: [], routingStatus: 'skipped' });

    const asked = await asOwner.send(channel.id, {
      content: 'One more thing',
      mentions: [agent.id],
      replyToId: said.id,
      requestKey: 'req-2',
      routing: 'decision',
    });
    expect(asked.recipientMemberIds).toEqual([agent.id]);
  });

  it('refuses a muted Agent posting on its own', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Secretary');
    await asOwner.setMemberMuted(channel.id, agent.id, true);

    await expect(
      asOwner.postAgentMessage(channel.id, {
        agentId: agent.agentId!,
        content: 'Hello',
        requestKey: 'post-1',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('stops what the Agent is answering, shows it muted and survives an environment change', async () => {
    const { asOwner, channel } = await createPair();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    const message = await asOwner.send(channel.id, {
      content: 'Long task',
      requestKey: 'req-1',
      routing: 'decision',
    });
    const [job] = await jobsOf(db, message.id);
    expect(job.status).toBe('queued');

    await asOwner.setMemberMuted(channel.id, agent.id, true);
    const [stopped] = await db.select().from(channelJobs).where(eq(channelJobs.id, job.id));
    expect(stopped.status).toBe('cancelled');

    await asOwner.updateAgentEnvironment(channel.id, agent.id, {});
    const member = (await asOwner.detail(channel.id)).members.find((m) => m.id === agent.id);
    expect(member?.muted).toBe(true);

    await asOwner.setMemberMuted(channel.id, agent.id, false);
    const unmuted = (await asOwner.detail(channel.id)).members.find((m) => m.id === agent.id);
    expect(unmuted?.muted).toBe(false);
  });

  it('is for admins, and not for the Agent of a direct conversation', async () => {
    const { asMember, asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    await expect(asMember.setMemberMuted(channel.id, agent.id, true)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const { channel: direct } = await asOwner.create({ agentId: agent.agentId!, title: 'DM' });
    const bound = (await asOwner.detail(direct.id)).members.find((m) => m.actorType === 'agent');
    await expect(asOwner.setMemberMuted(direct.id, bound!.id, true)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
