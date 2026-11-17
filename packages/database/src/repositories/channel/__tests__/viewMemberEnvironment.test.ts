// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers, devices } from '../../../schemas';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-view-environment');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel member environment', () => {
  it('shows every member where an Agent runs, named by its device', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    await db
      .update(channelMembers)
      .set({ config: { deviceId: 'device-1', workingDirectory: '/code/lobot' } })
      .where(eq(channelMembers.id, agent.id));
    await db
      .update(devices)
      .set({ friendlyName: 'Studio Mac', hostname: 'studio.local' })
      .where(eq(devices.deviceId, 'device-1'));

    const { members } = await asMember.detail(channel.id);
    expect(members.find((m) => m.id === agent.id)?.environment).toEqual({
      deviceId: 'device-1',
      deviceName: 'Studio Mac',
      workingDirectory: '/code/lobot',
    });
    expect(members.find((m) => !m.agentId)?.environment).toBeNull();
  });

  it('has no environment when the Channel sets none', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    await db.update(channelMembers).set({ config: {} }).where(eq(channelMembers.id, agent.id));

    const { members } = await asMember.detail(channel.id);
    expect(members.find((m) => m.id === agent.id)?.environment).toBeNull();
  });
});
