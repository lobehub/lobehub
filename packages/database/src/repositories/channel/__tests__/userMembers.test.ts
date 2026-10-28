// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers, workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-user-members');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(fixture.cleanup);

const create = async () => {
  const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await owner.create({ title: 'People' });
  return { channel, owner };
};

describe('Channel human membership', () => {
  it('lets an admin find and add a workspace member, then share messages without granting admin', async () => {
    const { owner, channel } = await create();
    expect(await owner.userCandidates(channel.id, 'mia')).toEqual([
      expect.objectContaining({ userId: fixture.memberId, username: 'mia' }),
    ]);
    const added = await owner.addUser(channel.id, fixture.memberId);
    expect(added).toMatchObject({ role: 'member', status: 'active', userId: fixture.memberId });
    expect((await owner.addUser(channel.id, fixture.memberId)).id).toBe(added.id);
    expect(await owner.userCandidates(channel.id)).toEqual([]);
    const member = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    expect(await member.list()).toEqual([
      expect.objectContaining({ id: channel.id, canDelete: false }),
    ]);
    await member.send(channel.id, {
      content: 'Hello owner',
      requestKey: 'hello',
      routing: 'fallback',
    });
    expect((await owner.detail(channel.id)).messages[0]).toMatchObject({
      content: 'Hello owner',
      userId: fixture.memberId,
    });
    await expect(member.remove(channel.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(member.addUser(channel.id, fixture.ownerId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(member.userCandidates(channel.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects non-workspace and removed users without inserting membership', async () => {
    const { owner, channel } = await create();
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, fixture.workspaceId),
          eq(workspaceMembers.userId, fixture.memberId),
        ),
      );
    expect(await owner.userCandidates(channel.id)).toEqual([]);
    await expect(owner.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(owner.addUser(channel.id, 'outside-user')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await owner.detail(channel.id)).members).toHaveLength(1);
  });

  it('rejects personal, wrong-scope, direct and trashed channels', async () => {
    const { owner, channel } = await create();
    const personal = new ChannelRepository(db, fixture.ownerId);
    await expect(personal.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const { channel: own } = await personal.create({ title: 'Personal' });
    await expect(personal.addUser(own.id, fixture.memberId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const agent = await fixture.addAgent(channel.id, 'Direct');
    const direct = await owner.create({ agentId: agent.agentId!, title: 'Direct' });
    await expect(owner.addUser(direct.channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await owner.remove(channel.id);
    await expect(owner.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('reactivates a retained member without resurrecting their former admin role', async () => {
    const { owner, channel } = await create();
    const previous = await fixture.addPerson(channel.id, fixture.memberId, 'admin');
    await db
      .update(channelMembers)
      .set({ status: 'left' })
      .where(eq(channelMembers.id, previous.id));
    expect(await owner.addUser(channel.id, fixture.memberId)).toMatchObject({
      id: previous.id,
      role: 'member',
      status: 'active',
    });
  });

  it('does not let a removed workspace administrator invite people using a retained channel role', async () => {
    const { owner, channel } = await create();
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, fixture.ownerId));
    await expect(owner.addUser(channel.id, fixture.memberId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(owner.userCandidates(channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
