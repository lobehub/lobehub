import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { deviceService } from '@/services/device';

import { useDeviceDirectorySource } from './useDeviceDirectorySource';

interface Row {
  deviceId: string;
  identitySource?: string;
  online: boolean;
  scope: 'personal' | 'workspace';
}

const sleepingCloud: Row = {
  deviceId: 'cloud-1',
  identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
  online: false,
  scope: 'personal',
};

/** The device list as the server reports it; `refresh` is what the next poll returns. */
const deviceList = create<{ devices: Row[]; refresh: () => Row[] }>(() => ({
  devices: [],
  refresh: () => [],
}));

/** Stable like the real store action, so it does not restart the wake effect. */
const refreshDevices = async () => {
  const next = deviceList.getState().refresh();
  deviceList.setState({ devices: next });
  return next;
};

vi.mock('@/store/device/useDeviceList', () => ({
  useDeviceList: () => ({
    data: deviceList((s) => s.devices),
    error: undefined,
    isConfirmed: true,
    isLoading: false,
    isValidating: false,
    mutate: refreshDevices,
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));

vi.mock('@/services/device', () => ({
  deviceService: { browseDirectory: vi.fn(), createDirectory: vi.fn(), wakeManagedDevice: vi.fn() },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

const renderListing = (deviceId: string) =>
  renderHook(() => useDeviceDirectorySource(deviceId).useListing(), { wrapper });

describe('useDeviceDirectorySource', () => {
  beforeEach(() => {
    vi.mocked(deviceService.browseDirectory)
      .mockReset()
      .mockResolvedValue({
        entries: [{ name: 'src', path: '/home/agent/src', readable: true }],
        path: '/home/agent',
      } as any);
    vi.mocked(deviceService.wakeManagedDevice)
      .mockReset()
      .mockResolvedValue({} as any);
  });

  it('wakes a sleeping cloud device before it lists, and lists once it is online', async () => {
    deviceList.setState({
      devices: [sleepingCloud],
      refresh: () => [{ ...sleepingCloud, online: true }],
    });

    const { result } = renderListing('cloud-1');

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(deviceService.wakeManagedDevice).toHaveBeenCalledWith({
      deviceId: 'cloud-1',
      scope: 'personal',
    });
    // Listed only after the wake: a listing sent to the sleeping device answers "unavailable".
    expect(vi.mocked(deviceService.wakeManagedDevice).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deviceService.browseDirectory).mock.invocationCallOrder[0],
    );
  });

  it('says it is waking the device while the device starts', async () => {
    // Never answers, so the device stays asleep for the whole test.
    vi.mocked(deviceService.wakeManagedDevice).mockReturnValue(new Promise(() => {}));
    deviceList.setState({ devices: [sleepingCloud], refresh: () => [sleepingCloud] });

    const { result } = renderListing('cloud-1');

    await waitFor(() => expect(deviceService.wakeManagedDevice).toHaveBeenCalled());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingLabel).toBe('workingDirectory.deviceWaking');
    expect(deviceService.browseDirectory).not.toHaveBeenCalled();
  });

  it('reports a failed wake, and wakes again on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deviceService.wakeManagedDevice).mockRejectedValueOnce(new Error('refused'));
    deviceList.setState({
      devices: [sleepingCloud],
      refresh: () => [{ ...sleepingCloud, online: true }],
    });

    const { result } = renderListing('cloud-1');

    await waitFor(() =>
      expect(result.current.errorLabel).toBe('workingDirectory.deviceWakeFailed'),
    );
    expect(deviceService.browseDirectory).not.toHaveBeenCalled();

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(deviceService.wakeManagedDevice).toHaveBeenCalledTimes(2);
  });

  it('lists an ordinary device without waking it', async () => {
    deviceList.setState({
      devices: [
        { deviceId: 'mac-1', identitySource: 'machine-id', online: true, scope: 'personal' },
      ],
    });

    const { result } = renderListing('mac-1');

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(deviceService.wakeManagedDevice).not.toHaveBeenCalled();
  });
});
