/**
 * @vitest-environment happy-dom
 *
 * The device list is a replica: a reload paints the persisted copy (device
 * names, `defaultCwd`) on the first frame, with presence unknown, and the
 * server confirms it in the background.
 */
import { randomUUID } from 'node:crypto';

import type { DeviceListItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { deviceService } from '@/services/device';

import { initialState } from './initialState';
import { deviceListResource, MAX_PERSISTED_DEVICES } from './projection';
import { deviceSelectors } from './selectors';
import { useDeviceStore } from './store';

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
const readRow = (scope: string) =>
  deviceListResource.storage!.get({ queryKey: ROW_KEY, scope }).then((row) => row?.data);

describe('device list replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`device-user-${randomUUID()}:personal`);
    act(() => useDeviceStore.setState(initialState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].map((value) =>
        deviceListResource.storage!.remove({ queryKey: ROW_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list after a reload, before the network answers', async () => {
    await deviceListResource.storage!.set(
      { queryKey: ROW_KEY, scope },
      { data: [device('dev-1')], updatedAt: 1 },
    );
    vi.mocked(deviceService.listDevices).mockImplementation(pending);

    renderHook(() => useDeviceStore((s) => s.useFetchDevices)(true), { wrapper });

    await waitFor(() =>
      expect(deviceSelectors.getDeviceDefaultCwd('dev-1')(useDeviceStore.getState())).toBe(
        '/repo/dev-1',
      ),
    );
    const state = useDeviceStore.getState();
    expect(deviceSelectors.getDeviceById('dev-1')(state)?.friendlyName).toBe('Mac dev-1');
    expect(deviceSelectors.isDeviceListLoaded(state)).toBe(true);
    // A stored row is not a confirmed one: presence stays unknown.
    expect(deviceSelectors.isDeviceListConfirmed(state)).toBe(false);
    expect(deviceSelectors.getDeviceById('dev-1')(state)).toMatchObject({
      channels: [],
      online: false,
      onlineUnknown: true,
    });
    expect(deviceSelectors.hasTerminalTarget(state)).toBe(false);
  });

  it('seeds the persisted list from a route loader without a mounted view', async () => {
    await deviceListResource.storage!.set(
      { queryKey: ROW_KEY, scope },
      { data: [device('dev-1')], updatedAt: 1 },
    );

    await expect(useDeviceStore.getState().preHydrateDeviceList()).resolves.toBe(true);

    expect(deviceSelectors.getDeviceById('dev-1')(useDeviceStore.getState())?.friendlyName).toBe(
      'Mac dev-1',
    );
  });

  it('keeps live presence in memory but persists it as unknown', async () => {
    vi.mocked(deviceService.listDevices).mockResolvedValue([device('dev-1')]);

    renderHook(() => useDeviceStore((s) => s.useFetchDevices)(true), { wrapper });

    await waitFor(() =>
      expect(deviceSelectors.isDeviceListConfirmed(useDeviceStore.getState())).toBe(true),
    );
    expect(deviceSelectors.getDeviceById('dev-1')(useDeviceStore.getState())).toMatchObject({
      online: true,
    });
    expect(deviceSelectors.hasTerminalTarget(useDeviceStore.getState())).toBe(true);

    await waitFor(async () =>
      expect(await readRow(scope)).toEqual([
        { ...device('dev-1'), channels: [], online: false, onlineUnknown: true },
      ]),
    );
  });

  it('caps the persisted snapshot', async () => {
    const many = Array.from({ length: MAX_PERSISTED_DEVICES + 5 }, (_, i) => device(`dev-${i}`));
    vi.mocked(deviceService.listDevices).mockResolvedValue(many);

    renderHook(() => useDeviceStore((s) => s.useFetchDevices)(true), { wrapper });

    await waitFor(async () => expect(await readRow(scope)).toHaveLength(MAX_PERSISTED_DEVICES));
    expect(deviceSelectors.deviceList(useDeviceStore.getState())).toHaveLength(many.length);
  });

  it('never paints another identity’s devices', async () => {
    const other = `device-user-${randomUUID()}:personal`;
    scopes.add(other);
    await deviceListResource.storage!.set(
      { queryKey: ROW_KEY, scope: other },
      { data: [device('theirs')], updatedAt: 1 },
    );
    vi.mocked(deviceService.listDevices).mockImplementation(pending);

    const sync = renderHook(() => useDeviceStore((s) => s.useFetchDevices)(true), { wrapper });

    await waitFor(() => expect(sync.result.current.isHydrated).toBe(true));
    expect(deviceSelectors.getDeviceById('theirs')(useDeviceStore.getState())).toBeUndefined();
    expect(deviceSelectors.isDeviceListLoaded(useDeviceStore.getState())).toBe(false);
  });

  it('rolls back an optimistic cwd write the server rejects', async () => {
    vi.mocked(deviceService.listDevices).mockResolvedValue([device('dev-1')]);
    renderHook(() => useDeviceStore((s) => s.useFetchDevices)(true), { wrapper });
    await waitFor(() =>
      expect(deviceSelectors.isDeviceListConfirmed(useDeviceStore.getState())).toBe(true),
    );
    vi.mocked(deviceService.updateDevice).mockRejectedValueOnce(new Error('save failed'));

    await expect(
      useDeviceStore.getState().updateDeviceCwd('dev-1', { path: '/elsewhere' }),
    ).rejects.toThrow('save failed');

    expect(deviceSelectors.getDeviceDefaultCwd('dev-1')(useDeviceStore.getState())).toBe(
      '/repo/dev-1',
    );
  });
});
