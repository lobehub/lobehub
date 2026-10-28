// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelAudit, channelMembers, channels } from '../../../schemas';
import { createChannelFixture, deviceConfig } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-settings');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const auditEvents = (channelId: string, event: string) =>
  db
    .select()
    .from(channelAudit)
    .where(and(eq(channelAudit.channelId, channelId), eq(channelAudit.event, event)));

describe('renaming a Channel', () => {
  it('lets an admin rename with a trimmed title and records it once', async () => {
    const team = await fixture.createTeamChannel('Old name');

    const renamed = await team.asOwner.rename(team.channel.id, '  New name  ');
    expect(renamed.title).toBe('New name');
    // Saving the same name again is a no-op, not a second change.
    await team.asOwner.rename(team.channel.id, 'New name');

    const [row] = await db.select().from(channels).where(eq(channels.id, team.channel.id));
    expect(row.title).toBe('New name');
    expect(await auditEvents(team.channel.id, 'renamed')).toHaveLength(1);
  });

  it('rejects plain members and blank titles without changing the name', async () => {
    const team = await fixture.createTeamChannel('Kept');

    await expect(team.asMember.rename(team.channel.id, 'Taken over')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(team.asOwner.rename(team.channel.id, '   ')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    const [row] = await db.select().from(channels).where(eq(channels.id, team.channel.id));
    expect(row.title).toBe('Kept');
  });
});

describe('an Agent member’s channel environment', () => {
  it('reads and replaces only the environment fields for an admin', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Coder', deviceConfig('/repo'));

    expect(await team.asOwner.agentEnvironment(team.channel.id, agent.id)).toEqual({
      agentId: agent.agentId,
      deviceId: 'device-1',
      workingDirectory: '/repo',
    });

    await team.asOwner.updateAgentEnvironment(team.channel.id, agent.id, {
      deviceId: 'device-1',
      workingDirectory: '/other',
      // Not an environment field; must not be stored on the member.
      ...({ model: 'injected' } as object),
    });

    const [member] = await db.select().from(channelMembers).where(eq(channelMembers.id, agent.id));
    expect(member.config).toEqual({ deviceId: 'device-1', workingDirectory: '/other' });
    expect(await auditEvents(team.channel.id, 'member_environment_changed')).toHaveLength(1);
  });

  it('keeps the environment from plain members and refuses people', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Coder', deviceConfig('/repo'));

    await expect(team.asMember.agentEnvironment(team.channel.id, agent.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      team.asMember.updateAgentEnvironment(team.channel.id, agent.id, {}),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      team.asOwner.updateAgentEnvironment(team.channel.id, team.member.id, {}),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [member] = await db.select().from(channelMembers).where(eq(channelMembers.id, agent.id));
    expect(member.config).toEqual({ deviceId: 'device-1', workingDirectory: '/repo' });
  });
});

describe('the public member projection', () => {
  it('says when each member joined', async () => {
    const team = await fixture.createTeamChannel();
    await fixture.addAgent(team.channel.id, 'Helper');

    const view = await team.asOwner.detail(team.channel.id);
    expect(view.members.length).toBeGreaterThan(2);
    for (const member of view.members) expect(member.joinedAt).toBeInstanceOf(Date);
  });
});
