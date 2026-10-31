// @vitest-environment node
import { DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-agent-member');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('adding an Agent to a Channel', () => {
  it.each(['empty', 'missing', 'private', 'trashed', 'personal', 'other workspace'])(
    'rejects an %s or inaccessible reference without creating a member',
    async (reason) => {
      const team = await fixture.createTeamChannel();
      const [agent] = await db
        .insert(agents)
        .values({
          userId: fixture.memberId,
          workspaceId: reason === 'personal' ? null : fixture.workspaceId,
          visibility: reason === 'private' ? 'private' : 'public',
          isDeleted: reason === 'trashed',
        })
        .returning();
      const repository =
        reason === 'other workspace' ? new ChannelRepository(db, fixture.ownerId) : team.asOwner;
      const channel =
        reason === 'other workspace'
          ? (await repository.create({ title: 'Personal' })).channel
          : team.channel;
      const agentId = reason === 'empty' ? ' ' : reason === 'missing' ? 'missing' : agent.id;
      await expect(repository.addAgent(channel.id, { agentId })).rejects.toMatchObject({
        code: reason === 'empty' ? 'BAD_REQUEST' : 'NOT_FOUND',
      });
      expect(
        await db
          .select()
          .from(channelMembers)
          .where(
            and(eq(channelMembers.channelId, channel.id), eq(channelMembers.actorType, 'agent')),
          ),
      ).toHaveLength(0);
    },
  );

  it('requires a Channel admin and accepts another workspace member’s public Agent', async () => {
    const team = await fixture.createTeamChannel();
    const [agent] = await db
      .insert(agents)
      .values({
        name: 'Current Agent name',
        userId: fixture.memberId,
        workspaceId: fixture.workspaceId,
      })
      .returning();
    await expect(
      team.asMember.addAgent(team.channel.id, { agentId: agent.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const added = await team.asOwner.addAgent(team.channel.id, { agentId: agent.id });
    expect(added).toMatchObject({ agentId: agent.id, config: {}, name: 'Current Agent name' });
  });

  it('labels LobeAI by its product name, not the generic fallback', async () => {
    const team = await fixture.createTeamChannel();
    const [inbox] = await db
      .insert(agents)
      .values({ slug: INBOX_SESSION_ID, userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const added = await team.asOwner.addAgent(team.channel.id, { agentId: inbox.id });
    expect(added.name).toBe(DEFAULT_INBOX_TITLE);
  });

  // Retrying a batch that partly succeeded resubmits the members that already joined.
  it('returns the existing member when the same Agent is added again', async () => {
    const team = await fixture.createTeamChannel();
    const [agent] = await db
      .insert(agents)
      .values({ userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const first = await team.asOwner.addAgent(team.channel.id, { agentId: agent.id });
    const retried = await team.asOwner.addAgent(team.channel.id, { agentId: agent.id });

    expect(retried.id).toBe(first.id);
    expect(
      await db
        .select()
        .from(channelMembers)
        .where(
          and(eq(channelMembers.channelId, team.channel.id), eq(channelMembers.agentId, agent.id)),
        ),
    ).toHaveLength(1);
  });

  it('permits an owner’s private Agent but checks the actual requester again at claim', async () => {
    const team = await fixture.createTeamChannel();
    const [agent] = await db
      .insert(agents)
      .values({
        userId: fixture.ownerId,
        workspaceId: fixture.workspaceId,
        visibility: 'private',
      })
      .returning();
    const added = await team.asOwner.addAgent(team.channel.id, { agentId: agent.id });
    const message = await team.asMember.send(team.channel.id, {
      content: 'Request',
      mentions: [added.id],
      requestKey: 'request',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    expect(
      await new ChannelExecutionRepository(db).claim(team.channel.id, job.id, lease),
    ).toBeNull();
  });

  it('keeps the member reference and public history after Agent deletion', async () => {
    const team = await fixture.createTeamChannel();
    const added = await fixture.addAgent(team.channel.id, 'Historical name');
    const message = await team.asMember.send(team.channel.id, {
      content: 'Request',
      mentions: [added.id],
      requestKey: 'request',
      routing: 'fallback',
    });
    await db.delete(agents).where(eq(agents.id, added.agentId!));
    const [retained] = await db
      .select()
      .from(channelMembers)
      .where(eq(channelMembers.id, added.id));
    expect(retained).toMatchObject({ agentId: null, name: 'Historical name' });
    const [job] = await jobsOf(db, message.id);
    expect(job.messageId).toBe(message.id);
    expect(
      await new ChannelExecutionRepository(db).claim(team.channel.id, job.id, lease),
    ).toBeNull();
  });
});
