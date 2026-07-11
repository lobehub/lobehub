import type { DeviceListItem, WorkingDirEntry } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

import { deviceSelectors } from './selectors';
import { useDeviceStore } from './store';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

const buildDevice = (overrides: Partial<DeviceListItem> = {}): DeviceListItem => ({
  channels: [],
  defaultCwd: '/repo',
  deviceId: 'dev-1',
  enroller: null,
  friendlyName: null,
  hostname: null,
  identitySource: 'machine-id',
  lastSeen: new Date(0).toISOString(),
  online: false,
  platform: null,
  registered: true,
  scope: 'personal',
  workingDirs: [],
  ...overrides,
});

describe('DeviceAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mutate).mockResolvedValue(undefined);
    vi.spyOn(deviceService, 'updateDevice').mockResolvedValue({ success: true });
    useDeviceStore.setState({ devices: [], isDevicesInit: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('clearDeviceDefaultCwd', () => {
    it('clears the device default without removing it from recent directories', async () => {
      const workingDirs: WorkingDirEntry[] = [
        { path: '/repo', repoType: 'git' },
        { path: '/other' },
      ];
      const otherDevice = buildDevice({
        defaultCwd: '/other-device',
        deviceId: 'dev-2',
        workingDirs: [{ path: '/other-device' }],
      });
      useDeviceStore.setState({
        devices: [buildDevice({ workingDirs }), otherDevice],
      });

      await useDeviceStore.getState().clearDeviceDefaultCwd('dev-1');

      const state = useDeviceStore.getState();
      expect(deviceSelectors.getDeviceDefaultCwd('dev-1')(state)).toBeUndefined();
      expect(deviceSelectors.getDeviceWorkingDirs('dev-1')(state)).toEqual(workingDirs);
      expect(state.devices.find((device) => device.deviceId === 'dev-2')).toEqual(otherDevice);
      expect(deviceService.updateDevice).toHaveBeenCalledWith({
        defaultCwd: null,
        deviceId: 'dev-1',
      });
      expect(mutate).toHaveBeenCalledWith(deviceKeys.listDevices());
    });

    it('does nothing when the target device does not exist', async () => {
      useDeviceStore.setState({ devices: [buildDevice()] });

      await useDeviceStore.getState().clearDeviceDefaultCwd('missing');

      expect(deviceService.updateDevice).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    });

    it('restores the previous default and revalidates when persistence fails', async () => {
      const workingDirs: WorkingDirEntry[] = [{ path: '/repo', repoType: 'git' }];
      useDeviceStore.setState({ devices: [buildDevice({ workingDirs })] });
      vi.mocked(deviceService.updateDevice).mockRejectedValueOnce(new Error('save failed'));

      await expect(useDeviceStore.getState().clearDeviceDefaultCwd('dev-1')).rejects.toThrow(
        'save failed',
      );

      const state = useDeviceStore.getState();
      expect(deviceSelectors.getDeviceDefaultCwd('dev-1')(state)).toBe('/repo');
      expect(deviceSelectors.getDeviceWorkingDirs('dev-1')(state)).toEqual(workingDirs);
      expect(mutate).toHaveBeenCalledWith(deviceKeys.listDevices());
    });
  });
});
