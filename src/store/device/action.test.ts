import type { DeviceListItem, WorkingDirEntry } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEVICE_LIST_SWR_KEY } from '@/features/DeviceManager/const';
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
    vi.spyOn(deviceService, 'setWorkspaceDeviceWorkingDirRepoType').mockResolvedValue({
      success: true,
    });
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

    // Task controls read the workspace-scoped `useDeviceList` entry, so a cwd
    // write that only revalidated this store's key left them showing stale recents.
    it('also revalidates the canonical device-list cache', async () => {
      useDeviceStore.setState({ devices: [buildDevice()] });

      await useDeviceStore.getState().clearDeviceDefaultCwd('dev-1');

      const matcher = vi
        .mocked(mutate)
        .mock.calls.map(([key]) => key)
        .find((key): key is (key: unknown) => boolean => typeof key === 'function');
      expect(matcher?.([DEVICE_LIST_SWR_KEY, 'ws-1'])).toBe(true);
      expect(matcher?.(deviceKeys.listDevices())).toBe(false);
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
      useDeviceStore.setState({ devices: [workspaceDevice()] });

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
      useDeviceStore.setState({ devices: [workspaceDevice()] });

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
      useDeviceStore.setState({ devices: [workspaceDevice()] });

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
      useDeviceStore.setState({ devices: [buildDevice({ workingDirs: [{ path: '/a' }] })] });

      await useDeviceStore.getState().removeDeviceWorkingDir('dev-1', '/a');

      expect(deviceService.updateDevice).toHaveBeenCalledWith({
        deviceId: 'dev-1',
        workingDirs: [],
      });
      expect(deviceService.updateWorkspaceDevice).not.toHaveBeenCalled();
    });
  });

  // The device store is a singleton and remembers which corrections it already
  // sent, so each case below uses its own path.
  describe('syncWorkingDirRepoType', () => {
    it('corrects a workspace device entry in place through the entry mutation', async () => {
      useDeviceStore.setState({
        devices: [
          buildDevice({
            deviceId: 'ws-dev',
            scope: 'workspace',
            workingDirs: [{ path: '/other' }, { path: '/cloned-later' }],
          }),
        ],
      });

      await useDeviceStore.getState().syncWorkingDirRepoType('ws-dev', '/cloned-later', 'github');

      expect(deviceService.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledWith({
        deviceId: 'ws-dev',
        path: '/cloned-later',
        repoType: 'github',
      });
      expect(deviceService.updateDevice).not.toHaveBeenCalled();
      expect(deviceSelectors.getDeviceWorkingDirs('ws-dev')(useDeviceStore.getState())).toEqual([
        { path: '/other' },
        { path: '/cloned-later', repoType: 'github' },
      ]);
      expect(mutate).toHaveBeenCalledWith(deviceKeys.listDevices());
    });

    it('writes the patched list for a personal device', async () => {
      useDeviceStore.setState({
        devices: [buildDevice({ workingDirs: [{ path: '/personal' }, { path: '/b' }] })],
      });

      await useDeviceStore.getState().syncWorkingDirRepoType('dev-1', '/personal', 'git');

      expect(deviceService.updateDevice).toHaveBeenCalledWith({
        deviceId: 'dev-1',
        workingDirs: [{ path: '/personal', repoType: 'git' }, { path: '/b' }],
      });
    });

    it('does nothing when the entry already matches or is not in the list', async () => {
      useDeviceStore.setState({
        devices: [buildDevice({ workingDirs: [{ path: '/same', repoType: 'git' }] })],
      });

      await useDeviceStore.getState().syncWorkingDirRepoType('dev-1', '/same', 'git');
      await useDeviceStore.getState().syncWorkingDirRepoType('dev-1', '/not-listed', 'git');

      expect(deviceService.updateDevice).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    });

    // A viewer cannot edit a shared device: the revalidation restores the stale
    // value, which must not trigger the same refused write again.
    it('never re-sends a correction the server refused', async () => {
      const device = buildDevice({
        deviceId: 'ws-dev',
        scope: 'workspace',
        workingDirs: [{ path: '/forbidden' }],
      });
      useDeviceStore.setState({ devices: [device] });
      vi.mocked(deviceService.setWorkspaceDeviceWorkingDirRepoType).mockRejectedValueOnce(
        Object.assign(new Error('forbidden'), { data: { code: 'FORBIDDEN' } }),
      );
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

      await expect(
        useDeviceStore.getState().syncWorkingDirRepoType('ws-dev', '/forbidden', 'github'),
      ).rejects.toThrow('forbidden');
      useDeviceStore.setState({ devices: [device] });
      now.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000);
      await useDeviceStore.getState().syncWorkingDirRepoType('ws-dev', '/forbidden', 'github');

      expect(deviceService.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledTimes(1);
    });

    // A network blip must not block the correction for the rest of the session.
    it('re-sends a correction after a transient failure once the retry delay passes', async () => {
      const device = buildDevice({
        deviceId: 'ws-dev',
        scope: 'workspace',
        workingDirs: [{ path: '/transient' }],
      });
      useDeviceStore.setState({ devices: [device] });
      vi.mocked(deviceService.setWorkspaceDeviceWorkingDirRepoType).mockRejectedValueOnce(
        new Error('fetch failed'),
      );
      const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);

      await expect(
        useDeviceStore.getState().syncWorkingDirRepoType('ws-dev', '/transient', 'github'),
      ).rejects.toThrow('fetch failed');
      // The revalidation right after the failure restores the stale entry.
      useDeviceStore.setState({ devices: [device] });
      await useDeviceStore.getState().syncWorkingDirRepoType('ws-dev', '/transient', 'github');
      expect(deviceService.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledTimes(1);

      now.mockReturnValue(2_000_000 + 61 * 1000);
      await useDeviceStore.getState().syncWorkingDirRepoType('ws-dev', '/transient', 'github');
      expect(deviceService.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledTimes(2);
    });

    // The dir lost its repo and was cloned into again: the second `git` is a
    // new change, not a repeat of the first.
    it('re-sends a value it already wrote once the entry changed back', async () => {
      useDeviceStore.setState({
        devices: [buildDevice({ workingDirs: [{ path: '/recloned' }] })],
      });

      await useDeviceStore.getState().syncWorkingDirRepoType('dev-1', '/recloned', 'git');
      await useDeviceStore.getState().syncWorkingDirRepoType('dev-1', '/recloned', undefined);
      await useDeviceStore.getState().syncWorkingDirRepoType('dev-1', '/recloned', 'git');

      expect(deviceService.updateDevice).toHaveBeenCalledTimes(3);
      expect(deviceService.updateDevice).toHaveBeenLastCalledWith({
        deviceId: 'dev-1',
        workingDirs: [{ path: '/recloned', repoType: 'git' }],
      });
    });
  });
});
