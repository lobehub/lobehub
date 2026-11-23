// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelRepository } from '@/database/repositories/channel';
import {
  createChannelFixture,
  deviceConfig,
} from '@/database/repositories/channel/__tests__/testUtils';
import {
  channelMemberGrants,
  channelMessages,
  channels,
  devices,
  workspaceMembers,
} from '@/database/schemas';

import { ChannelService } from './ChannelService';
import { announceDeviceGrants } from './deviceGrantCard';
import { notifyChannel } from './notify';

vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./mention', () => ({ notifyChannelMentions: vi.fn() }));
vi.mock('./routingConfig', () => ({ resolveChannelRoutingConfig: vi.fn() }));
vi.mock('./featureGate', () => ({ assertChannelEnabled: vi.fn() }));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-device-grant-card');
beforeEach(async () => {
  vi.mocked(notifyChannel).mockClear();
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: fixture.ownerId, workspaceId: fixture.workspaceId },
    { role: 'member', userId: fixture.memberId, workspaceId: fixture.workspaceId },
  ]);
  // The member's own workspace device, kept private.
  await db.insert(devices).values({
    deviceId: 'private-1',
    friendlyName: 'Mia MacBook',
    identitySource: 'fallback',
    userId: fixture.memberId,
    visibility: 'private',
    workspaceId: fixture.workspaceId,
  });
});
afterEach(fixture.cleanup);

const cardsIn = (channelId: string) =>
  db.select().from(channelMessages).where(eq(channelMessages.channelId, channelId));

/** The owner points the Agent at the member's private device; the member has a conversation with it. */
const setup = async () => {
  const { channel } = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(
    channel.id,
    'Coder',
    deviceConfig('/repo', 'private-1', fixture.memberId),
  );
  const [grant] = await db
    .select()
    .from(channelMemberGrants)
    .where(eq(channelMemberGrants.memberId, agent.id));
  const asMember = new ChannelRepository(db, fixture.memberId, fixture.workspaceId);
  const direct = await asMember.create({
    agentConfig: {},
    agentId: agent.agentId!,
    title: 'Coder',
  });
  return { agent, channel, direct: direct.channel, grant };
};

describe('device request cards', () => {
  it('asks the device owner once, as the Agent, in their conversation with it', async () => {
    const { agent, channel, direct, grant } = await setup();

    await announceDeviceGrants(db, channel.id);
    await announceDeviceGrants(db, channel.id);

    const cards = await cardsIn(direct.id);
    expect(cards).toEqual([
      expect.objectContaining({
        agentId: agent.agentId,
        content:
          '[Device request] Olivia Owner asks to run Coder in "Team" on Mia MacBook (/repo).',
        metadata: {
          deviceGrant: {
            agentName: 'Coder',
            channelId: channel.id,
            channelTitle: 'Team',
            deviceId: 'private-1',
            deviceName: 'Mia MacBook',
            grantId: grant.id,
            requesterName: 'Olivia Owner',
            requesterUserId: fixture.ownerId,
            workingDirectory: '/repo',
          },
        },
        userId: null,
      }),
    ]);
    expect(vi.mocked(notifyChannel).mock.calls.filter(([, id]) => id === direct.id)).toHaveLength(
      1,
    );

    const { messages } = await new ChannelRepository(
      db,
      fixture.memberId,
      fixture.workspaceId,
    ).detail(direct.id);
    expect(messages[0].deviceGrant).toMatchObject({ grantId: grant.id, status: 'pending' });
  });

  it('refreshes the card when the owner decides, and asks no one about a decided request', async () => {
    const { channel, direct, grant } = await setup();
    await announceDeviceGrants(db, channel.id);
    vi.mocked(notifyChannel).mockClear();

    await new ChannelService(db, fixture.memberId, fixture.workspaceId).decideDeviceGrant(
      grant.id,
      'approve',
    );
    expect(vi.mocked(notifyChannel).mock.calls.map(([, id]) => id)).toContain(direct.id);

    await db.delete(channelMessages).where(eq(channelMessages.channelId, direct.id));
    await announceDeviceGrants(db, channel.id);
    expect(await cardsIn(direct.id)).toEqual([]);
  });

  it('leaves it to the Channel and settings when the owner trashed the conversation', async () => {
    const { channel, direct } = await setup();
    await db.update(channels).set({ isDeleted: true }).where(eq(channels.id, direct.id));

    await expect(announceDeviceGrants(db, channel.id)).resolves.toBeUndefined();
    expect(await cardsIn(direct.id)).toEqual([]);
  });
});
