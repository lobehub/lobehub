import type { DeviceListItem, WorkingDirEntry } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDeviceStore } from '@/store/device';

import { resolveRepoType, useRepoType } from '../useRepoType';

const rpc = vi.hoisted(() => ({
  detectLocalRepoType: vi.fn(),
  getLocalFileStats: vi.fn(),
  refreshDeviceList: vi.fn(),
  setWorkspaceDeviceWorkingDirRepoType: vi.fn(),
  statPath: vi.fn(),
  updateDevice: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDesktop: true,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'test-workspace',
}));

// The device-list revalidation that follows every write; a case can make it
// bring back what the server still stores.
vi.mock('@/features/DeviceManager/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshDeviceList: () => rpc.refreshDeviceList(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    device: {
      setWorkspaceDeviceWorkingDirRepoType: { mutate: rpc.setWorkspaceDeviceWorkingDirRepoType },
      statPath: { query: rpc.statPath },
      updateDevice: { mutate: rpc.updateDevice },
    },
  },
}));

vi.mock('@/services/electron/git', () => ({
  electronGitService: { detectRepoType: rpc.detectLocalRepoType },
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { getLocalFileStats: rpc.getLocalFileStats },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: { gatewayDeviceInfo: { deviceId: string } }) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: 'this-machine' } }),
}));

const device = (
  deviceId: string,
  workingDirs: WorkingDirEntry[],
  scope: DeviceListItem['scope'] = 'workspace',
): DeviceListItem => ({
  channels: [],
  defaultCwd: null,
  deviceId,
  enroller: null,
  friendlyName: null,
  hostname: null,
  identitySource: 'machine-id',
  lastSeen: new Date(0).toISOString(),
  online: true,
  platform: 'linux',
  registered: true,
  scope,
  visibility: 'public',
  workingDirs,
});

const workingDirsOf = (deviceId: string) =>
  useDeviceStore.getState().devices.find((d) => d.deviceId === deviceId)?.workingDirs;

const renderRepoType = (path: string, deviceId?: string) => {
  const cache = new Map();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(SWRConfig, { value: { provider: () => cache } }, children);
  return renderHook(() => useRepoType(path, deviceId), { wrapper });
};

// The device store is a singleton that remembers the corrections it already
// sent, so every case uses its own path.
describe('useRepoType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.setWorkspaceDeviceWorkingDirRepoType.mockResolvedValue({ success: true });
    rpc.updateDevice.mockResolvedValue({ success: true });
    rpc.refreshDeviceList.mockResolvedValue(undefined);
    useDeviceStore.setState({ devices: [] });
  });

  // The dir was registered on the remote device while still an empty folder,
  // then cloned into: its cached entry has no repoType and nothing re-checked it.
  it('corrects a remote dir that became a repo after it was registered', async () => {
    useDeviceStore.setState({ devices: [device('remote', [{ path: '/srv/cloned-later' }])] });
    rpc.statPath.mockResolvedValue({ exists: true, isDirectory: true, repoType: 'github' });

    const { result } = renderRepoType('/srv/cloned-later', 'remote');

    await waitFor(() => expect(result.current).toBe('github'));
    expect(rpc.statPath).toHaveBeenCalledWith({ deviceId: 'remote', path: '/srv/cloned-later' });
    await waitFor(() =>
      expect(rpc.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledWith({
        deviceId: 'remote',
        path: '/srv/cloned-later',
        repoType: 'github',
      }),
    );
    expect(workingDirsOf('remote')).toEqual([{ path: '/srv/cloned-later', repoType: 'github' }]);
  });

  it('writes back once the device list loads after the probe settled', async () => {
    rpc.statPath.mockResolvedValue({ exists: true, isDirectory: true, repoType: 'git' });

    const { result } = renderRepoType('/srv/late-list', 'remote');

    await waitFor(() => expect(result.current).toBe('git'));
    expect(rpc.setWorkspaceDeviceWorkingDirRepoType).not.toHaveBeenCalled();

    act(() => {
      useDeviceStore.setState({ devices: [device('remote', [{ path: '/srv/late-list' }])] });
    });

    await waitFor(() =>
      expect(rpc.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledWith({
        deviceId: 'remote',
        path: '/srv/late-list',
        repoType: 'git',
      }),
    );
  });

  it('keeps the cached type when the remote device cannot be reached', async () => {
    useDeviceStore.setState({
      devices: [device('remote', [{ path: '/srv/offline', repoType: 'github' }])],
    });
    rpc.statPath.mockResolvedValue(null);

    const { result } = renderRepoType('/srv/offline', 'remote');

    await waitFor(() => expect(rpc.statPath).toHaveBeenCalled());
    expect(result.current).toBe('github');
    expect(rpc.setWorkspaceDeviceWorkingDirRepoType).not.toHaveBeenCalled();
  });

  it('clears the cached type when the dir is no longer a repo', async () => {
    useDeviceStore.setState({
      devices: [device('remote', [{ path: '/srv/repo-removed', repoType: 'git' }])],
    });
    rpc.statPath.mockResolvedValue({ exists: true, isDirectory: true });

    const { result } = renderRepoType('/srv/repo-removed', 'remote');

    await waitFor(() => expect(result.current).toBeUndefined());
    await waitFor(() =>
      expect(rpc.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledWith({
        deviceId: 'remote',
        path: '/srv/repo-removed',
        repoType: undefined,
      }),
    );
  });

  it('probes the same path separately on each device', async () => {
    useDeviceStore.setState({
      devices: [device('vm-a', [{ path: '/same' }]), device('vm-b', [{ path: '/same' }])],
    });
    rpc.statPath.mockImplementation(async ({ deviceId }: { deviceId: string }) =>
      deviceId === 'vm-a'
        ? { exists: true, isDirectory: true, repoType: 'github' }
        : { exists: true, isDirectory: true },
    );
    const cache = new Map();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(SWRConfig, { value: { provider: () => cache } }, children);

    const { result } = renderHook(
      () => ({ a: useRepoType('/same', 'vm-a'), b: useRepoType('/same', 'vm-b') }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.a).toBe('github'));
    expect(result.current.b).toBeUndefined();
    expect(rpc.statPath).toHaveBeenCalledTimes(2);
  });

  it('writes a local probe back to this machine’s device entry', async () => {
    useDeviceStore.setState({
      devices: [device('this-machine', [{ path: '/local/cloned-later' }], 'personal')],
    });
    rpc.detectLocalRepoType.mockResolvedValue('git');

    const { result } = renderRepoType('/local/cloned-later');

    await waitFor(() => expect(result.current).toBe('git'));
    expect(rpc.statPath).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(rpc.updateDevice).toHaveBeenCalledWith({
        deviceId: 'this-machine',
        workingDirs: [{ path: '/local/cloned-later', repoType: 'git' }],
      }),
    );
  });

  // An unmounted volume: the repo is still there, just not reachable. The IPC
  // probe answers `undefined` for it exactly as for a plain folder.
  it('keeps a local repo type when its path is missing', async () => {
    useDeviceStore.setState({
      devices: [
        device('this-machine', [{ path: '/Volumes/offline/repo', repoType: 'github' }], 'personal'),
      ],
    });
    rpc.detectLocalRepoType.mockResolvedValue(undefined);
    rpc.getLocalFileStats.mockRejectedValue(new Error('ENOENT'));

    const { result } = renderRepoType('/Volumes/offline/repo');

    await waitFor(() => expect(rpc.getLocalFileStats).toHaveBeenCalled());
    expect(result.current).toBe('github');
    expect(rpc.updateDevice).not.toHaveBeenCalled();
    expect(workingDirsOf('this-machine')).toEqual([
      { path: '/Volumes/offline/repo', repoType: 'github' },
    ]);
  });

  it('clears a local repo type when the existing dir is no longer a repo', async () => {
    useDeviceStore.setState({
      devices: [
        device('this-machine', [{ path: '/local/repo-removed', repoType: 'git' }], 'personal'),
      ],
    });
    rpc.detectLocalRepoType.mockResolvedValue(undefined);
    rpc.getLocalFileStats.mockResolvedValue({ size: 4096 });

    const { result } = renderRepoType('/local/repo-removed');

    await waitFor(() => expect(result.current).toBeUndefined());
    await waitFor(() =>
      expect(rpc.updateDevice).toHaveBeenCalledWith({
        deviceId: 'this-machine',
        workingDirs: [{ path: '/local/repo-removed' }],
      }),
    );
  });

  // A network blip on the write: the revalidation brings the stale entry back
  // and the store holds the correction back for a while. The mounted hook has
  // to retry by itself once that delay runs out, not wait for a remount.
  it('retries a transiently failed correction while it stays mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const stale = device('remote-retry', [{ path: '/srv/retry-later' }]);
      useDeviceStore.setState({ devices: [stale] });
      rpc.statPath.mockResolvedValue({ exists: true, isDirectory: true, repoType: 'github' });
      rpc.setWorkspaceDeviceWorkingDirRepoType.mockRejectedValueOnce(new Error('fetch failed'));
      rpc.refreshDeviceList.mockImplementationOnce(async () => {
        useDeviceStore.setState({ devices: [stale] });
      });

      const { result } = renderRepoType('/srv/retry-later', 'remote-retry');

      await waitFor(() =>
        expect(rpc.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledTimes(1),
      );
      await waitFor(() =>
        expect(workingDirsOf('remote-retry')).toEqual([{ path: '/srv/retry-later' }]),
      );
      expect(result.current).toBe('github');
      expect(rpc.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(61 * 1000);
      });

      await waitFor(() =>
        expect(rpc.setWorkspaceDeviceWorkingDirRepoType).toHaveBeenCalledTimes(2),
      );
      expect(workingDirsOf('remote-retry')).toEqual([
        { path: '/srv/retry-later', repoType: 'github' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('resolveRepoType', () => {
  // The `.git` was removed but the dir is still there: the probe says "not a
  // repo", and the topic's old snapshot must not bring the git chips back.
  it('keeps a verified "not a repo" over the fallback', () => {
    expect(resolveRepoType({ repoType: undefined, verified: true }, 'github')).toBeUndefined();
  });

  // A deleted worktree or an offline device cannot be probed.
  it('falls back for a dir that could not be probed', () => {
    expect(resolveRepoType({ repoType: undefined, verified: false }, 'github')).toBe('github');
  });

  it('prefers the probed or cached type over the fallback', () => {
    expect(resolveRepoType({ repoType: 'git', verified: true }, 'github')).toBe('git');
    expect(resolveRepoType({ repoType: 'git', verified: false }, 'github')).toBe('git');
  });
});
