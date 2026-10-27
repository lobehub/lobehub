// @vitest-environment node
import { CHANNEL_DELETED_AGENT_NAME, CHANNEL_DELETED_USER_NAME } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers, channelMessages, channels, users } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-identity');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const sendInput = { content: 'Hello', requestKey: 'hello', routing: 'jev' as const };
const createAgent = async (workspaceId: string | null = fixture.workspaceId) => {
  const [agent] = await db
    .insert(agents)
    .values({
      name: 'Assistant',
      userId: fixture.ownerId,
      workspaceId,
    })
    .returning();
  return agent;
};

const publish = async (channelId: string, messageId: string) => {
  const [job] = await jobsOf(db, messageId);
  const claim = (await execution.claim(channelId, job.id, lease))!;
  expect(claim).not.toBeNull();
  await execution.accepted(channelId, job.id, {});
  await execution.saveDraft(channelId, job.id, 'Answer');
  const replyId = await execution.publish(channelId, job.id);
  await execution.releaseWriter(channelId, job.id);
  return { claim, replyId };
};

describe('direct Channel identity', () => {
  it.each([null, fixture.workspaceId])(
    'creates a private user/Agent conversation in scope %s',
    async (workspaceId) => {
      const agent = await createAgent(workspaceId);
      const repository = new ChannelRepository(db, fixture.ownerId, workspaceId);
      const { channel } = await repository.create({ agentId: agent.id, title: 'Direct' });
      expect(channel).toMatchObject({
        agentId: agent.id,
        userId: fixture.ownerId,
        visibility: 'private',
        workspaceId,
      });
      const members = await db
        .select()
        .from(channelMembers)
        .where(eq(channelMembers.channelId, channel.id));
      expect(members).toHaveLength(2);
      expect(members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actorType: 'user', userId: fixture.ownerId }),
          expect.objectContaining({ actorType: 'agent', agentId: agent.id }),
        ]),
      );
      const request = await repository.send(channel.id, sendInput);
      expect(request).toMatchObject({
        userId: fixture.ownerId,
        agentId: null,
        routingStatus: 'directed',
      });
      const { replyId } = await publish(channel.id, request.id);
      const [reply] = await db
        .select()
        .from(channelMessages)
        .where(eq(channelMessages.id, replyId));
      expect(reply).toMatchObject({ agentId: agent.id, userId: null });
    },
  );

  it('reuses one direct conversation per person, Agent and scope', async () => {
    const agent = await createAgent();
    const repository = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const [first, second] = await Promise.all([
      repository.create({ agentId: agent.id, title: 'Direct' }),
      repository.create({ agentId: agent.id, title: 'Again' }),
    ]);
    expect(second.channel.id).toBe(first.channel.id);
    expect(second.member.id).toBe(first.member.id);
    expect(await db.select().from(channels).where(eq(channels.agentId, agent.id))).toHaveLength(1);
    await expect(
      db.insert(channels).values({
        agentId: agent.id,
        title: 'Duplicate',
        userId: fixture.ownerId,
        workspaceId: fixture.workspaceId,
      }),
    ).rejects.toThrow();

    const other = await new ChannelRepository(db, fixture.memberId, fixture.workspaceId).create({
      agentId: agent.id,
      title: 'Direct',
    });
    expect(other.channel.id).not.toBe(first.channel.id);

    // A transferred Agent starts a new conversation in its new scope.
    await db.update(agents).set({ workspaceId: null }).where(eq(agents.id, agent.id));
    const personal = await new ChannelRepository(db, fixture.ownerId).create({
      agentId: agent.id,
      title: 'Direct',
    });
    expect(personal.channel.id).not.toBe(first.channel.id);
    expect(personal.channel.workspaceId).toBeNull();
  });

  it('keeps a group unbound even when it contains a single Agent', async () => {
    const team = await fixture.createTeamChannel();
    await fixture.addAgent(team.channel.id, 'Only Agent');
    expect(team.channel.agentId).toBeNull();
    expect((await team.asMember.send(team.channel.id, sendInput)).routingStatus).toBe('pending');
  });

  it.each(['public', 'empty', 'missing', 'private Agent', 'foreign scope'])(
    'rejects %s direct creation without leaving a Channel behind',
    async (reason) => {
      const agent = await createAgent(reason === 'foreign scope' ? null : fixture.workspaceId);
      if (reason === 'private Agent')
        await db
          .update(agents)
          .set({ userId: fixture.memberId, visibility: 'private' })
          .where(eq(agents.id, agent.id));
      const repository = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
      await expect(
        repository.create({
          agentId: reason === 'empty' ? '' : reason === 'missing' ? 'missing' : agent.id,
          title: 'Invalid',
          visibility: reason === 'public' ? 'public' : 'private',
        }),
      ).rejects.toMatchObject({
        code: ['public', 'empty'].includes(reason) ? 'BAD_REQUEST' : 'NOT_FOUND',
      });
      expect(await repository.list()).toEqual([]);
    },
  );

  it('rejects additional Agents and keeps other workspace users outside the direct conversation', async () => {
    const agent = await createAgent();
    const other = await createAgent();
    const repository = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const { channel } = await repository.create({ agentId: agent.id, title: 'Direct' });
    await expect(repository.addAgent(channel.id, { agentId: other.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(repository.addAgent(channel.id, { agentId: agent.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // Even an accidentally granted membership must not expose a direct conversation.
    await fixture.addPerson(channel.id, fixture.memberId, 'admin');
    const outsider = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    expect(await outsider.findAccess(channel.id)).toBeUndefined();
    expect(await outsider.list()).toEqual([]);
    await expect(outsider.send(channel.id, sendInput)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      db.update(channels).set({ visibility: 'public' }).where(eq(channels.id, channel.id)),
    ).rejects.toThrow();
  });

  it('deletes direct conversations with their Agent while retaining group messages', async () => {
    const agent = await createAgent();
    const group = await fixture.createTeamChannel();
    const member = await group.asOwner.addAgent(group.channel.id, { agentId: agent.id });
    const { channel: direct } = await group.asOwner.create({ agentId: agent.id, title: 'Direct' });
    const directRequest = await group.asOwner.send(direct.id, sendInput);
    await publish(direct.id, directRequest.id);
    const groupRequest = await group.asMember.send(group.channel.id, {
      ...sendInput,
      mentions: [member.id],
    });
    const { replyId } = await publish(group.channel.id, groupRequest.id);

    await db.delete(agents).where(eq(agents.id, agent.id));
    expect(await db.select().from(channels).where(eq(channels.id, direct.id))).toEqual([]);
    expect(
      await db.select().from(channelMessages).where(eq(channelMessages.channelId, direct.id)),
    ).toEqual([]);
    const [reply] = await db.select().from(channelMessages).where(eq(channelMessages.id, replyId));
    expect(reply).toMatchObject({ agentId: null, userId: null, content: 'Answer' });
    expect(await group.asMember.findAccess(group.channel.id)).toBeDefined();

    const nextAgent = await fixture.addAgent(group.channel.id, 'Next');
    const next = await group.asMember.send(group.channel.id, {
      ...sendInput,
      requestKey: 'next',
      mentions: [nextAgent.id],
    });
    const [nextJob] = await jobsOf(db, next.id);
    await execution.claim(group.channel.id, nextJob.id, lease);
    expect(await execution.input(group.channel.id, nextJob.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: replyId,
          author: { id: null, name: CHANNEL_DELETED_AGENT_NAME, type: 'agent' },
        }),
      ]),
    );
  });
});

describe('direct message sender references', () => {
  it('derives the sender from the authenticated member, ignoring supplied identities', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Agent');
    const forged = { ...sendInput, userId: fixture.ownerId, agentId: agent.agentId };
    expect(await team.asMember.send(team.channel.id, forged)).toMatchObject({
      userId: fixture.memberId,
      agentId: null,
    });
  });

  it('publishes as the claimed Agent even if the member is later rebound', async () => {
    const team = await fixture.createTeamChannel();
    const member = await fixture.addAgent(team.channel.id, 'Original');
    const request = await team.asMember.send(team.channel.id, {
      ...sendInput,
      mentions: [member.id],
    });
    const [job] = await jobsOf(db, request.id);
    await execution.claim(team.channel.id, job.id, lease);
    const replacement = await createAgent();
    await db
      .update(channelMembers)
      .set({ agentId: replacement.id })
      .where(eq(channelMembers.id, member.id));
    await execution.accepted(team.channel.id, job.id, {});
    await execution.saveDraft(team.channel.id, job.id, 'Original answer');
    const replyId = await execution.publish(team.channel.id, job.id);
    const [reply] = await db.select().from(channelMessages).where(eq(channelMessages.id, replyId));
    expect(reply).toMatchObject({ agentId: member.agentId, userId: null });
    await execution.releaseWriter(team.channel.id, job.id);
  });

  it('retains human message content with a deleted-user identity', async () => {
    const team = await fixture.createTeamChannel();
    const member = await fixture.addAgent(team.channel.id, 'Agent');
    const request = await team.asMember.send(team.channel.id, {
      ...sendInput,
      mentions: [member.id],
    });
    const [job] = await jobsOf(db, request.id);
    await execution.claim(team.channel.id, job.id, lease);
    await db.delete(users).where(eq(users.id, fixture.memberId));
    expect(await execution.input(team.channel.id, job.id)).toEqual([
      expect.objectContaining({
        content: 'Hello',
        author: { id: null, name: CHANNEL_DELETED_USER_NAME, type: 'user' },
      }),
    ]);
  });

  it.each(['left', 'deleted'])(
    'does not route delayed requests after their author %s',
    async (reason) => {
      const team = await fixture.createTeamChannel();
      const member = await fixture.addAgent(team.channel.id, 'Agent');
      const request = await team.asMember.send(team.channel.id, sendInput);
      if (reason === 'deleted') await db.delete(users).where(eq(users.id, fixture.memberId));
      else
        await db
          .update(channelMembers)
          .set({ active: false })
          .where(
            and(
              eq(channelMembers.channelId, team.channel.id),
              eq(channelMembers.userId, fixture.memberId),
            ),
          );
      await execution.resolveRouting(team.channel.id, request.id, 1, {
        memberIds: [member.id],
        reason: 'Chosen',
        status: 'assigned',
      });
      expect(await jobsOf(db, request.id)).toEqual([]);
      const [unassigned] = await db
        .select()
        .from(channelMessages)
        .where(eq(channelMessages.id, request.id));
      expect(unassigned.routingStatus).toBe('unassigned');
    },
  );
});
