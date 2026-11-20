// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers, channels } from '../../../schemas';
import { createChannelFixture, deviceConfig } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-wake-config');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const memberConfig = async (memberId: string) => {
  const [member] = await db.select().from(channelMembers).where(eq(channelMembers.id, memberId));
  return member.config;
};

describe('a Channel’s reply strategy', () => {
  it('stores the channel’s and each member’s own, and resets them to the defaults', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Coder', deviceConfig('/repo'));

    expect(await team.asOwner.wakeConfig(team.channel.id)).toEqual({
      channel: null,
      members: [{ memberId: agent.id, wake: null }],
    });

    await team.asOwner.updateChannelWakeConfig(team.channel.id, { pace: 'calm' });
    await team.asOwner.updateMemberWakeConfig(team.channel.id, agent.id, {
      rules: { scope: 'none' },
    });
    expect(await team.asOwner.wakeConfig(team.channel.id)).toEqual({
      channel: { pace: 'calm' },
      members: [{ memberId: agent.id, wake: { rules: { scope: 'none' } } }],
    });
    // The member's environment is untouched by its reply strategy.
    expect(await memberConfig(agent.id)).toEqual({
      deviceId: 'device-1',
      wake: { rules: { scope: 'none' } },
      workingDirectory: '/repo',
    });

    await team.asOwner.updateChannelWakeConfig(team.channel.id, null);
    await team.asOwner.updateMemberWakeConfig(team.channel.id, agent.id, null);
    const [channel] = await db.select().from(channels).where(eq(channels.id, team.channel.id));
    expect(channel.config).toBeNull();
    expect(await memberConfig(agent.id)).toEqual({
      deviceId: 'device-1',
      workingDirectory: '/repo',
    });
  });

  it('keeps a member’s reply strategy when its environment changes', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Coder', deviceConfig('/repo'));
    await team.asOwner.updateMemberWakeConfig(team.channel.id, agent.id, { pace: 'active' });

    await team.asOwner.updateAgentEnvironment(team.channel.id, agent.id, {
      deviceId: 'device-1',
      workingDirectory: '/other',
    });

    expect(await memberConfig(agent.id)).toEqual({
      deviceId: 'device-1',
      wake: { pace: 'active' },
      workingDirectory: '/other',
    });
  });

  it('files a member’s wake records under its Agent owner in the channel’s workspace', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Coder');
    const [owner] = await db
      .select({ userId: agents.userId })
      .from(agents)
      .where(eq(agents.id, agent.agentId!));

    expect(await team.asOwner.memberWakeRecordScope(team.channel.id, agent.id)).toEqual({
      userId: owner.userId,
      workspaceId: team.channel.workspaceId,
    });
    await expect(
      team.asMember.memberWakeRecordScope(team.channel.id, agent.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets only admins read or change it', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Coder');

    for (const call of [
      () => team.asMember.wakeConfig(team.channel.id),
      () => team.asMember.updateChannelWakeConfig(team.channel.id, { pace: 'calm' }),
      () => team.asMember.updateMemberWakeConfig(team.channel.id, agent.id, { pace: 'calm' }),
    ])
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
