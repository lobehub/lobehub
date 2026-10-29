/**
 * @vitest-environment happy-dom
 *
 * `useDeviceList` reads the device store's replica: every device surface shares
 * one request per scope, and a reload paints the persisted list (presence
 * unknown) before the server answers.
 */
import { randomUUID } from 'node:crypto';

import type { DeviceListItem } from '@lobechat/types';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { deviceService } from '@/services/device';
import { useUserStore } from '@/store/user';

import { initialState } from './initialState';
import { deviceListResource } from './projection';
import { useDeviceStore } from './store';
import { isDevicePresenceUnknown, useDeviceList } from './useDeviceList';

vi.mock('@/services/device', () => ({
  deviceService: { listDevices: vi.fn(), updateDevice: vi.fn() },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const device = (deviceId: string, overrides: Partial<DeviceListItem> = {}): DeviceListItem => ({
  channels: [{ channel: 'cli', connectedAt: new Date(0).toISOString() } as never],
  defaultCwd: `/repo/${deviceId}`,
  deviceId,
  enroller: null,
  friendlyName: `Mac ${deviceId}`,
  hostname: null,
  identitySource: 'machine-id',
  lastSeen: new Date(0).toISOString(),
  online: true,
  platform: 'darwin',
  registered: true,
  scope: 'personal',
  visibility: null,
  workingDirs: [{ path: `/repo/${deviceId}` }],
  ...overrides,
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const ROW_KEY = deviceListResource.storageKey({});

describe('useDeviceList', () => {
  let scope = '';

  beforeEach(() => {
    scope = `device-list-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => {
      useDeviceStore.setState(initialState);
      useUserStore.setState({ isSignedIn: true });
    });
  });

  afterEach(async () => {
    await deviceListResource.storage!.remove({ queryKey: ROW_KEY, scope });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shares one request with the device store instead of fetching the list twice', async () => {
    vi.mocked(deviceService.listDevices).mockResolvedValue([device('dev-1')]);

    const { result } = renderHook(
      () => {
        // A picker and a working-directory chip mounted side by side.
        const list = useDeviceList();
        useDeviceStore((s) => s.useFetchDevices)(true);
        return list;
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual([device('dev-1')]));
    expect(deviceService.listDevices).toHaveBeenCalledTimes(1);
  });

  it('lets a reader that mounts after the first answer reuse it', async () => {
    vi.mocked(deviceService.listDevices).mockResolvedValue([device('dev-1')]);
    let lateData: DeviceListItem[] | undefined;
    const Reader = () => {
      useDeviceList();
      return null;
    };
    const LateReader = () => {
      lateData = useDeviceList().data;
      return null;
    };
    const page = (late: boolean) =>
      wrapper({
        children: [
          createElement(Reader, { key: 'a' }),
          late && createElement(LateReader, { key: 'b' }),
        ],
      });

    const view = render(page(false));
    await waitFor(() => expect(deviceService.listDevices).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useDeviceStore.getState().deviceListMap.all).toHaveLength(1));

    // A popover / chip opening a moment later on the same page.
    view.rerender(page(true));

    expect(lateData).toEqual([device('dev-1')]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(deviceService.listDevices).toHaveBeenCalledTimes(1);
  });

  it('paints the persisted list without a loading state, presence unknown', async () => {
    await deviceListResource.storage!.set(
      { queryKey: ROW_KEY, scope },
      { data: [device('dev-1')], updatedAt: 1 },
    );
    vi.mocked(deviceService.listDevices).mockImplementation(pending);

    const { result } = renderHook(() => useDeviceList(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.isLoading).toBe(false);
    const [row] = result.current.data!;
    expect(row).toMatchObject({ friendlyName: 'Mac dev-1', online: false });
    // The stored `online: false` is a placeholder, not an offline device.
    expect(isDevicePresenceUnknown(row)).toBe(true);
  });

  it('keeps a restored empty list pending until the server confirms it', async () => {
    await deviceListResource.storage!.set({ queryKey: ROW_KEY, scope }, { data: [], updatedAt: 1 });
    let answer!: (rows: DeviceListItem[]) => void;
    vi.mocked(deviceService.listDevices).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );

    const { result } = renderHook(() => useDeviceList(), { wrapper });

    await waitFor(() => expect(useDeviceStore.getState().deviceListMap.all).toEqual([]));
    // The empty copy is no proof the user has no device.
    expect(result.current).toMatchObject({ data: undefined, isConfirmed: false, isLoading: true });

    await waitFor(() => expect(deviceService.listDevices).toHaveBeenCalled());
    await act(async () => answer([]));

    await waitFor(() =>
      expect(result.current).toMatchObject({ data: [], isConfirmed: true, isLoading: false }),
    );
  });

  it('surfaces a failed refresh over a restored empty list', async () => {
    await deviceListResource.storage!.set({ queryKey: ROW_KEY, scope }, { data: [], updatedAt: 1 });
    vi.mocked(deviceService.listDevices).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDeviceList(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current).toMatchObject({ data: undefined, isConfirmed: false, isLoading: false });
  });

  it('keeps the restored rows when the refresh fails', async () => {
    await deviceListResource.storage!.set(
      { queryKey: ROW_KEY, scope },
      { data: [device('dev-1')], updatedAt: 1 },
    );
    vi.mocked(deviceService.listDevices).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDeviceList(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.isConfirmed).toBe(false);
  });

  it('shows a cwd written through the store without waiting for a refetch', async () => {
    vi.mocked(deviceService.listDevices).mockResolvedValue([device('dev-1')]);
    // Hold the write open: the optimistic row is what the list must show.
    vi.mocked(deviceService.updateDevice).mockImplementation(pending);

    const { result } = renderHook(() => useDeviceList(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    act(() => {
      void useDeviceStore.getState().updateDeviceCwd('dev-1', { path: '/elsewhere' });
    });

    await waitFor(() => expect(result.current.data?.[0]?.defaultCwd).toBe('/elsewhere'));
  });

  it('resolves mutate with the refreshed rows', async () => {
    vi.mocked(deviceService.listDevices).mockResolvedValue([device('dev-1', { online: false })]);

    const { result } = renderHook(() => useDeviceList(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    vi.mocked(deviceService.listDevices).mockResolvedValue([device('dev-1')]);
    let next: DeviceListItem[] | undefined;
    await act(async () => {
      next = await result.current.mutate();
    });

    expect(next?.[0]?.online).toBe(true);
  });

  it('stays idle while signed out', () => {
    act(() => useUserStore.setState({ isSignedIn: false }));

    const { result } = renderHook(() => useDeviceList(), { wrapper });

    expect(result.current).toMatchObject({ data: undefined, isLoading: false });
    expect(deviceService.listDevices).not.toHaveBeenCalled();
  });
});
