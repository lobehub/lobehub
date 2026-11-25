// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wakePickedDevices } from './pickedDeviceWake';

const { afterUnscoped, findWakeableManagedDevices, wakeChannel, wakeManagedDevice, waitOnline } =
  vi.hoisted(() => ({
    afterUnscoped: vi.fn(),
    findWakeableManagedDevices: vi.fn(),
    wakeChannel: vi.fn(),
    wakeManagedDevice: vi.fn(),
    waitOnline: vi.fn(),
  }));
vi.mock('@/server/services/deviceGateway/managedDeviceWake', () => ({
  findWakeableManagedDevices,
  wakeManagedDevice,
  waitForManagedDeviceOnline: waitOnline,
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ afterUnscoped }));
vi.mock('./queue', () => ({ wakeChannel }));

const db = {} as never;
const cloud = { deviceId: 'cloud-1', scope: 'workspace', workspaceId: 'ws' } as const;
const background = async () => {
  for (const [work] of afterUnscoped.mock.calls) await work();
};

describe('wakePickedDevices', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findWakeableManagedDevices.mockResolvedValue([cloud]);
    wakeManagedDevice.mockResolvedValue(true);
    waitOnline.mockResolvedValue(true);
  });

  it('wakes a sleeping cloud device picked in the Channel and advances it once online', async () => {
    await wakePickedDevices(db, {
      channelId: 'channel-1',
      devices: [
        { deviceId: 'cloud-1', ownerId: 'owner' },
        // Two replies waiting on the same device wake it once.
        { deviceId: 'cloud-1', ownerId: 'owner' },
      ],
      onlineDeviceIds: ['other'],
      workspaceId: 'ws',
    });

    expect(findWakeableManagedDevices).toHaveBeenCalledExactlyOnceWith(
      { db, userId: 'owner', workspaceId: 'ws' },
      ['cloud-1'],
      ['other'],
    );
    expect(wakeManagedDevice).toHaveBeenCalledExactlyOnceWith('owner', cloud);
    expect(wakeChannel).not.toHaveBeenCalled();

    await background();
    expect(waitOnline).toHaveBeenCalledWith('owner', cloud);
    expect(wakeChannel).toHaveBeenCalledExactlyOnceWith('channel-1');
  });

  it('leaves an ordinary device, or one with no owner, to come online on its own', async () => {
    findWakeableManagedDevices.mockResolvedValue([]);
    await wakePickedDevices(db, {
      channelId: 'channel-1',
      devices: [{ deviceId: 'mac', ownerId: 'owner' }, { deviceId: 'cloud-1' }],
      onlineDeviceIds: [],
      workspaceId: null,
    });

    expect(findWakeableManagedDevices).toHaveBeenCalledExactlyOnceWith(
      { db, userId: 'owner', workspaceId: undefined },
      ['mac'],
      [],
    );
    expect(wakeManagedDevice).not.toHaveBeenCalled();
    expect(afterUnscoped).not.toHaveBeenCalled();
  });

  it('does not wait for a device whose wake was refused', async () => {
    wakeManagedDevice.mockResolvedValue(false);
    await wakePickedDevices(db, {
      channelId: 'channel-2',
      devices: [{ deviceId: 'cloud-1', ownerId: 'owner' }],
      onlineDeviceIds: [],
      workspaceId: 'ws',
    });

    expect(afterUnscoped).not.toHaveBeenCalled();
  });

  it('keeps one wait per Channel and device while the device starts', async () => {
    const input = {
      channelId: 'channel-3',
      devices: [{ deviceId: 'cloud-1', ownerId: 'owner' }],
      onlineDeviceIds: [],
      workspaceId: 'ws',
    };
    await wakePickedDevices(db, input);
    await wakePickedDevices(db, input);

    // The wake is repeated (the provider dedupes it), the wait for it is not.
    expect(wakeManagedDevice).toHaveBeenCalledTimes(2);
    expect(afterUnscoped).toHaveBeenCalledTimes(1);

    await background();
    await wakePickedDevices(db, input);
    expect(afterUnscoped).toHaveBeenCalledTimes(2);
  });

  it('never fails the Channel advance, nor the other wakes, when a lookup throws', async () => {
    const other = { deviceId: 'cloud-2', scope: 'workspace', workspaceId: 'ws' } as const;
    findWakeableManagedDevices
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([other]);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      wakePickedDevices(db, {
        channelId: 'channel-4',
        devices: [
          { deviceId: 'cloud-1', ownerId: 'owner' },
          { deviceId: 'cloud-2', ownerId: 'owner' },
        ],
        onlineDeviceIds: [],
        workspaceId: 'ws',
      }),
    ).resolves.toBeUndefined();
    expect(wakeManagedDevice).toHaveBeenCalledExactlyOnceWith('owner', other);
  });
});
