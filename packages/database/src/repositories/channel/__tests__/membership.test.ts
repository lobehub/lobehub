// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  channelAudit,
  channelJobs,
  channelMembers,
  projects,
  workspaceMembers,
} from '../../../schemas';
import { ChannelRepository, removeAgentFromProjectChannels } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-membership');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(async () => {
  await db.delete(projects).where(eq(projects.workspaceId, fixture.workspaceId));
  await fixture.cleanup();
});

const statusOf = async (memberId: string) => {
  const [row] = await db
    .select({ status: channelMembers.status })
    .from(channelMembers)
    .where(eq(channelMembers.id, memberId));
  return row?.status;
};

describe('removing Channel members', () => {
  it('lets an admin remove a person, who then loses access', async () => {
    const { asMember, asOwner, channel, member } = await fixture.createTeamChannel();
    await asOwner.removeMember(channel.id, member.id);

    expect(await statusOf(member.id)).toBe('removed');
    expect(await asMember.findAccess(channel.id)).toBeUndefined();
    expect(await asMember.list()).toEqual([]);
    const [entry] = await db
      .select()
      .from(channelAudit)
      .where(and(eq(channelAudit.channelId, channel.id), eq(channelAudit.event, 'member_removed')));
    expect(entry).toMatchObject({ targetId: member.id, details: { actorType: 'user' } });
  });

  it('removes an Agent and cancels its open replies', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Helper');
    const message = await asOwner.send(channel.id, {
      content: 'Please help',
      mentions: [agent.id],
      requestKey: 'help',
    });
    const [queued] = await db
      .select()
      .from(channelJobs)
      .where(eq(channelJobs.messageId, message.id));
    expect(queued.status).toBe('queued');

    await asOwner.removeMember(channel.id, agent.id);

    expect(await statusOf(agent.id)).toBe('removed');
    const [job] = await db.select().from(channelJobs).where(eq(channelJobs.id, queued.id));
    expect(job.status).not.toBe('queued');
  });

  it('keeps the owner and the caller, and leaves other admins to the owner', async () => {
    const { asMember, asOwner, channel, member, owner } = await fixture.createTeamChannel();
    await expect(asOwner.removeMember(channel.id, owner.id)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(asMember.removeMember(channel.id, owner.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await db.update(channelMembers).set({ role: 'admin' }).where(eq(channelMembers.id, member.id));
    await expect(asMember.removeMember(channel.id, owner.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await asOwner.removeMember(channel.id, member.id);
    expect(await statusOf(member.id)).toBe('removed');
  });

  it('refuses a direct conversation, which keeps its two sides', async () => {
    const [agent] = await db
      .insert(agents)
      .values({ userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const { channel } = await owner.create({ agentId: agent.id, title: 'Direct' });
    const [seat] = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.actorType, 'agent')));

    await expect(owner.removeMember(channel.id, seat.id)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('leaving a Channel', () => {
  it('lets a member leave and keeps the owner', async () => {
    const { asMember, asOwner, channel, member } = await fixture.createTeamChannel();
    expect(await asMember.leave(channel.id)).toEqual({ readable: false });

    expect(await statusOf(member.id)).toBe('left');
    expect(await asMember.list()).toEqual([]);
    await expect(asOwner.leave(channel.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lists the caller’s own role', async () => {
    const { asMember, asOwner } = await fixture.createTeamChannel();
    expect((await asOwner.list())[0].memberRole).toBe('owner');
    expect((await asMember.list())[0].memberRole).toBe('member');
  });

  it('lets someone who left an open project Channel join again, but not someone removed', async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: 'Apollo', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const teammate = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    const { channel } = await owner.create({ projectId: project.id, title: 'General' });

    const joined = await teammate.join(channel.id);
    expect(await teammate.leave(channel.id)).toEqual({ readable: true });
    expect(await teammate.list()).toEqual([
      expect.objectContaining({ id: channel.id, joined: false, memberRole: null }),
    ]);
    await teammate.join(channel.id);
    expect(await statusOf(joined.member.id)).toBe('active');

    await owner.removeMember(channel.id, joined.member.id);
    await expect(teammate.join(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports an archived project Channel as no longer readable once left', async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: 'Apollo', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const teammate = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    const { channel } = await owner.create({ projectId: project.id, title: 'General' });
    await teammate.join(channel.id);
    await owner.archive(channel.id);

    expect(await teammate.leave(channel.id)).toEqual({ readable: false });
  });
});

describe('an Agent leaving a project', () => {
  it('leaves every Channel of that project and no other', async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: 'Apollo', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();
    const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
    const { channel: general } = await owner.create({ projectId: project.id, title: 'General' });
    const { channel: design } = await owner.create({ projectId: project.id, title: 'Design' });
    const { channel: outside } = await owner.create({ title: 'Outside' });
    const seat = await fixture.addAgent(general.id, 'Helper');
    const second = await owner.addAgent(design.id, { agentId: seat.agentId! });
    const kept = await owner.addAgent(outside.id, { agentId: seat.agentId! });

    const { channelIds } = await removeAgentFromProjectChannels(db, project.id, seat.agentId!);

    expect(channelIds.sort()).toEqual([general.id, design.id].sort());
    expect(await statusOf(seat.id)).toBe('removed');
    expect(await statusOf(second.id)).toBe('removed');
    expect(await statusOf(kept.id)).toBe('active');
  });
});
