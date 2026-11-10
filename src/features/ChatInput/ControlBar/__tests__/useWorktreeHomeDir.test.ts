import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { useWorktreeHomeDir } from '../useWorktreeHomeDir';

const getDeviceSystemInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/device', () => ({
  deviceService: { getDeviceSystemInfo: getDeviceSystemInfoMock },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

const setLocalHome = (home?: string) =>
  useElectronStore.setState((s) => ({
    appState: { ...s.appState, userPath: home ? ({ home } as never) : undefined },
  }));

describe('useWorktreeHomeDir', () => {
  beforeEach(() => {
    getDeviceSystemInfoMock.mockReset();
    setLocalHome('/Users/local');
  });

  it('uses the desktop home for the local machine without asking a device', async () => {
    const { result } = renderHook(() => useWorktreeHomeDir(undefined, true));

    await expect(result.current()).resolves.toBe('/Users/local');
    expect(getDeviceSystemInfoMock).not.toHaveBeenCalled();
  });

  it('does not ask a remote device until prefetch or resolve', async () => {
    getDeviceSystemInfoMock.mockResolvedValue({ homePath: '/home/remote' });

    const { result } = renderHook(() => useWorktreeHomeDir('device-lazy'));
    expect(getDeviceSystemInfoMock).not.toHaveBeenCalled();

    await expect(result.current()).resolves.toBe('/home/remote');
    expect(getDeviceSystemInfoMock).toHaveBeenCalledWith({ deviceId: 'device-lazy' });
  });

  it('reuses the prefetched home a remote device reports', async () => {
    getDeviceSystemInfoMock.mockResolvedValue({ homePath: '/home/remote' });

    const { result } = renderHook(() => useWorktreeHomeDir('device-prefetch', true));
    await waitFor(() => expect(getDeviceSystemInfoMock).toHaveBeenCalledTimes(1));

    // Let SWR commit the prefetched answer before resolving.
    await act(async () => {});

    await expect(result.current()).resolves.toBe('/home/remote');
    expect(getDeviceSystemInfoMock).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined for a device that reports no home or fails', async () => {
    getDeviceSystemInfoMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useWorktreeHomeDir('device-no-home'));
    await expect(result.current()).resolves.toBeUndefined();

    getDeviceSystemInfoMock.mockRejectedValueOnce(new Error('offline'));
    await expect(result.current()).resolves.toBeUndefined();
  });
});
