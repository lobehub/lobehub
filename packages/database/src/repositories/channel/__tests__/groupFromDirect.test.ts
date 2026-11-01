// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers, channels, workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-group-from-direct');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(fixture.cleanup);

const environment = () => ({
  deviceId: 'device-1',
  deviceOwnerId: fixture.ownerId,
  workingDirectory: '/repo',
});

const createAgent = async (name: string, workspaceId: string | null) => {
  const [agent] = await db
    .insert(agents)
    .values({ name, userId: fixture.ownerId, workspaceId })
    .returning();
  return agent;
};

const createDirect = async (workspaceId: string | null = fixture.workspaceId) => {
  const agent = await createAgent('Ada', workspaceId);
  const owner = new ChannelRepository(db, fixture.ownerId, workspaceId);
  const { channel } = await owner.create({
    agentConfig: environment(),
    agentId: agent.id,
    title: 'Ada',
  });
  return { agent, direct: channel, owner };
};

const membersOf = (channelId: string) =>
  db.select().from(channelMembers).where(eq(channelMembers.channelId, channelId));

describe('inviting from a direct conversation', () => {
  it('starts a group with its Agent, in the same environment, and the invitees', async () => {
    const { agent, direct, owner } = await createDirect();
    const helper = await createAgent('Bo', fixture.workspaceId);
    expect(await owner.userCandidates(direct.id)).toEqual([
      expect.objectContaining({ userId: fixture.memberId }),
    ]);

    const { channel, member } = await owner.createGroupFromDirect(direct.id, {
      agents: [{ agentId: helper.id }],
      title: 'Ada, Bo, mia',
      userIds: [fixture.memberId],
    });

    expect(channel).toMatchObject({
      agentId: null,
      title: 'Ada, Bo, mia',
      userId: fixture.ownerId,
      visibility: 'private',
      workspaceId: fixture.workspaceId,
    });
    expect(member).toMatchObject({ role: 'owner', userId: fixture.ownerId });
    const members = await membersOf(channel.id);
    expect(members).toHaveLength(4);
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: agent.id, config: environment(), name: 'Ada' }),
        expect.objectContaining({ actorType: 'agent', agentId: helper.id }),
        expect.objectContaining({ role: 'member', status: 'active', userId: fixture.memberId }),
      ]),
    );
    // The direct conversation stays one person and one Agent, and the invitee only sees the group.
    expect(await membersOf(direct.id)).toHaveLength(2);
    const invitee = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
    expect((await invitee.list()).map(({ id }) => id)).toEqual([channel.id]);
  });

  it('starts a personal group with more Agents', async () => {
    const { agent, direct, owner } = await createDirect(null);
    const helper = await createAgent('Bo', null);
    const { channel } = await owner.createGroupFromDirect(direct.id, {
      agents: [{ agentId: helper.id }],
      title: 'Ada, Bo',
    });
    expect(channel.workspaceId).toBeNull();
    expect((await membersOf(channel.id)).map(({ agentId }) => agentId)).toEqual(
      expect.arrayContaining([agent.id, helper.id]),
    );
  });

  it.each([
    ['people into a personal group', null, { userIds: [fixture.memberId] }],
    ['an empty invitation', 'workspace', {}],
  ])('refuses %s without creating anything', async (_, scope, invitees) => {
    const workspaceId = scope ? fixture.workspaceId : null;
    const { direct, owner } = await createDirect(workspaceId);
    await expect(
      owner.createGroupFromDirect(direct.id, { title: 'Group', ...invitees }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await db.select().from(channels).where(eq(channels.userId, fixture.ownerId))).toEqual([
      expect.objectContaining({ id: direct.id }),
    ]);
  });

  it('only starts groups from a direct conversation', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await expect(
      asOwner.createGroupFromDirect(channel.id, { title: 'Group', userIds: [fixture.memberId] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
