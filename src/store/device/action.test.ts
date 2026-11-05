import type { DeviceListItem, WorkingDirEntry } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { deviceService } from '@/services/device';

import { initialState } from './initialState';
import { DEVICE_LIST_KEY } from './projection';
import { deviceSelectors } from './selectors';
import { useDeviceStore } from './store';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

const seedDevices = (devices: DeviceListItem[]) =>
  useDeviceStore.setState({ deviceListMap: { [DEVICE_LIST_KEY]: devices } });

/** The SWR matchers the action revalidated with. */
const revalidatedMatchers = () =>
  vi
    .mocked(mutate)
    .mock.calls.map(([key]) => key)
    .filter((key): key is (key: unknown) => boolean => typeof key === 'function');

const revalidatedDeviceListReplica = () =>
  revalidatedMatchers().some((matcher) =>
    matcher(['replica:sync', 'deviceList', 1, cacheScope.get(), DEVICE_LIST_KEY, {}]),
  );

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
  visibility: null,
  workingDirs: [],
  ...overrides,
});

describe('DeviceAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mutate).mockResolvedValue(undefined);
    vi.spyOn(deviceService, 'updateDevice').mockResolvedValue({ success: true });
    vi.spyOn(deviceService, 'updateWorkspaceDevice').mockResolvedValue({ success: true });
    vi.spyOn(deviceService, 'addWorkspaceDeviceWorkingDir').mockResolvedValue({ success: true });
    vi.spyOn(deviceService, 'removeWorkspaceDeviceWorkingDir').mockResolvedValue({
      success: true,
    });
    useDeviceStore.setState(initialState);
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
      seedDevices([buildDevice({ workingDirs }), otherDevice]);

      await useDeviceStore.getState().clearDeviceDefaultCwd('dev-1');

      const state = useDeviceStore.getState();
      expect(deviceSelectors.getDeviceDefaultCwd('dev-1')(state)).toBeUndefined();
      expect(deviceSelectors.getDeviceWorkingDirs('dev-1')(state)).toEqual(workingDirs);
      expect(deviceSelectors.getDeviceById('dev-2')(state)).toEqual(otherDevice);
      expect(deviceService.updateDevice).toHaveBeenCalledWith({
        defaultCwd: null,
        deviceId: 'dev-1',
      });
      expect(revalidatedDeviceListReplica()).toBe(true);
    });

    it('does nothing when the target device does not exist', async () => {
      seedDevices([buildDevice()]);

      await useDeviceStore.getState().clearDeviceDefaultCwd('missing');

      expect(deviceService.updateDevice).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    });

    it('restores the previous default and revalidates when persistence fails', async () => {
      const workingDirs: WorkingDirEntry[] = [{ path: '/repo', repoType: 'git' }];
      seedDevices([buildDevice({ workingDirs })]);
      vi.mocked(deviceService.updateDevice).mockRejectedValueOnce(new Error('save failed'));

      await expect(useDeviceStore.getState().clearDeviceDefaultCwd('dev-1')).rejects.toThrow(
        'save failed',
      );

      const state = useDeviceStore.getState();
      expect(deviceSelectors.getDeviceDefaultCwd('dev-1')(state)).toBe('/repo');
      expect(deviceSelectors.getDeviceWorkingDirs('dev-1')(state)).toEqual(workingDirs);
      expect(revalidatedDeviceListReplica()).toBe(true);
    });
  });

  // Workspace devices are stored under `workspace_id`; the personal mutation is
  // userId-scoped and would silently drop the write, so removed dirs came back.
  describe('workspace devices', () => {
    const workspaceDevice = () =>
      buildDevice({
        deviceId: 'ws-dev',
        scope: 'workspace',
        workingDirs: [{ path: '/a' }, { path: '/b' }],
      });

    // Members share the list, so only the touched entry is sent — never this
    // client's whole (possibly stale) snapshot.
    it('removes one recent dir through the workspace entry mutation', async () => {
      seedDevices([workspaceDevice()]);

      await useDeviceStore.getState().removeDeviceWorkingDir('ws-dev', '/a');

      expect(deviceService.removeWorkspaceDeviceWorkingDir).toHaveBeenCalledWith({
        deviceId: 'ws-dev',
        path: '/a',
      });
      expect(deviceService.updateWorkspaceDevice).not.toHaveBeenCalled();
      expect(deviceService.updateDevice).not.toHaveBeenCalled();
      expect(deviceSelectors.getDeviceWorkingDirs('ws-dev')(useDeviceStore.getState())).toEqual([
        { path: '/b' },
      ]);
    });

    it('adds one picked dir through the workspace entry mutation', async () => {
      seedDevices([workspaceDevice()]);

      await useDeviceStore
        .getState()
        .updateDeviceCwd('ws-dev', { path: ' /c ' }, { setDefault: false });

      expect(deviceService.addWorkspaceDeviceWorkingDir).toHaveBeenCalledWith({
        deviceId: 'ws-dev',
        entry: { path: '/c' },
      });
      expect(deviceService.updateWorkspaceDevice).not.toHaveBeenCalled();
      expect(deviceService.updateDevice).not.toHaveBeenCalled();
    });

    it('sets the device default separately from the entry add', async () => {
      seedDevices([workspaceDevice()]);

      await useDeviceStore.getState().updateDeviceCwd('ws-dev', { path: '/c' });

      expect(deviceService.addWorkspaceDeviceWorkingDir).toHaveBeenCalledWith({
        deviceId: 'ws-dev',
        entry: { path: '/c' },
      });
      expect(deviceService.updateWorkspaceDevice).toHaveBeenCalledWith({
        defaultCwd: '/c',
        deviceId: 'ws-dev',
      });
    });

    it('keeps personal devices on the personal mutation', async () => {
      seedDevices([buildDevice({ workingDirs: [{ path: '/a' }] })]);

      await useDeviceStore.getState().removeDeviceWorkingDir('dev-1', '/a');

      expect(deviceService.updateDevice).toHaveBeenCalledWith({
        deviceId: 'dev-1',
        workingDirs: [],
      });
      expect(deviceService.updateWorkspaceDevice).not.toHaveBeenCalled();
    });
  });
});
