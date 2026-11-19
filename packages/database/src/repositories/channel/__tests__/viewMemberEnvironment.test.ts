// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers, devices } from '../../../schemas';
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

  it("never names another principal's device that shares the id", async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    await db.insert(devices).values([
      {
        deviceId: 'device-shared-id',
        friendlyName: 'Someone else',
        identitySource: 'fallback',
        userId: fixture.memberId,
      },
    ]);
    await db
      .update(channelMembers)
      .set({ config: { deviceId: 'device-shared-id', deviceOwnerId: fixture.ownerId } })
      .where(eq(channelMembers.id, agent.id));

    const hidden = (await asMember.detail(channel.id)).members.find((m) => m.id === agent.id);
    expect(hidden?.environment?.deviceName).toBeNull();

    await db.insert(devices).values({
      deviceId: 'device-shared-id',
      friendlyName: 'Owner laptop',
      identitySource: 'fallback',
      userId: fixture.ownerId,
    });
    const own = (await asMember.detail(channel.id)).members.find((m) => m.id === agent.id);
    expect(own?.environment?.deviceName).toBe('Owner laptop');
  });

  it('has no environment when neither the Channel nor the Agent sets a device', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    await db.update(channelMembers).set({ config: {} }).where(eq(channelMembers.id, agent.id));

    const { members } = await asMember.detail(channel.id);
    expect(members.find((m) => m.id === agent.id)?.environment).toBeNull();
  });

  it("falls back to the Agent's own bound device and folder when the Channel sets none", async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    await db.update(channelMembers).set({ config: {} }).where(eq(channelMembers.id, agent.id));
    await db
      .update(agents)
      .set({
        agencyConfig: {
          boundDeviceId: 'device-1',
          executionTarget: 'device',
          workingDirByDevice: { 'device-1': { path: '/code/own' } },
        },
      })
      .where(eq(agents.id, agent.agentId!));
    await db
      .update(devices)
      .set({ defaultCwd: '/home/owner', friendlyName: 'Studio Mac' })
      .where(eq(devices.deviceId, 'device-1'));

    const environment = async () =>
      (await asMember.detail(channel.id)).members.find((m) => m.id === agent.id)?.environment;
    expect(await environment()).toEqual({
      deviceId: 'device-1',
      deviceName: 'Studio Mac',
      workingDirectory: '/code/own',
    });

    // No folder of its own there: the device's default.
    await db
      .update(agents)
      .set({ agencyConfig: { boundDeviceId: 'device-1', executionTarget: 'device' } })
      .where(eq(agents.id, agent.agentId!));
    expect((await environment())?.workingDirectory).toBe('/home/owner');

    // A target that picks its device per run has nothing to show ahead of it.
    await db
      .update(agents)
      .set({ agencyConfig: { boundDeviceId: 'device-1', executionTarget: 'auto' } })
      .where(eq(agents.id, agent.agentId!));
    expect(await environment()).toBeNull();
  });
});
