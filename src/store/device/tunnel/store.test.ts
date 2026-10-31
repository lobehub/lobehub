/**
 * @vitest-environment happy-dom
 *
 * Tunnel links and listening ports are replicas. Writes land in the replica
 * (memory and storage), a failed read keeps what is on screen, and nothing a
 * create response carries as a credential reaches storage.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { deviceService } from '@/services/device';

import { useFetchDeviceListeningPorts, useFetchDeviceTunnels } from '../tunnelHooks';
import {
  deviceListeningPortsResource,
  type DeviceTunnelLink,
  deviceTunnelsResource,
  MAX_PERSISTED_PORTS,
} from './projection';
import { initialDeviceTunnelState, useDeviceTunnelStore } from './store';

vi.mock('@/services/device', () => ({
  deviceService: {
    listListeningPorts: vi.fn(),
    listTunnels: vi.fn(),
  },
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

const pending = () => new Promise<never>(() => {});

const DEVICE = 'device-1';
const TUNNELS = { deviceId: DEVICE };
const PORTS = { cwd: '/repo', deviceId: DEVICE };

const link = (slug: string, port = 3000): DeviceTunnelLink => ({
  createdAt: 1,
  deviceId: DEVICE,
  hostname: `${port}--${slug}.lobe.sh`,
  port,
  slug,
  url: `https://${port}--${slug}.lobe.sh/`,
});

const port = (value: number) => ({
  command: 'node',
  inProject: true,
  loopback: 'both' as const,
  port: value,
});

describe('device tunnel replicas', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };
  const storedTunnels = async () =>
    (
      await deviceTunnelsResource.storage!.get({
        queryKey: deviceTunnelsResource.storageKey(TUNNELS),
        scope,
      })
    )?.data;
  const storedPorts = async () =>
    (
      await deviceListeningPortsResource.storage!.get({
        queryKey: deviceListeningPortsResource.storageKey(PORTS),
        scope,
      })
    )?.data;
  const seedTunnels = (links: DeviceTunnelLink[]) =>
    deviceTunnelsResource.storage!.set(
      { queryKey: deviceTunnelsResource.storageKey(TUNNELS), scope },
      { data: links, updatedAt: 1 },
    );

  beforeEach(() => {
    useScope(`tunnel-user-${randomUUID()}:personal`);
    act(() => useDeviceTunnelStore.setState(initialDeviceTunnelState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) => [
        deviceTunnelsResource.storage!.remove({
          queryKey: deviceTunnelsResource.storageKey(TUNNELS),
          scope: value,
        }),
        deviceListeningPortsResource.storage!.remove({
          queryKey: deviceListeningPortsResource.storageKey(PORTS),
          scope: value,
        }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('removes a revoked link from storage too, so a reload cannot paint it back', async () => {
    vi.mocked(deviceService.listTunnels).mockResolvedValue([link('keep'), link('gone', 4000)]);
    const { result } = renderHook(() => useFetchDeviceTunnels(DEVICE), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    await waitFor(async () => expect((await storedTunnels())?.length).toBe(2));

    // The re-read after the revoke fails: the write alone must still hold.
    vi.mocked(deviceService.listTunnels).mockRejectedValue(new Error('offline'));
    act(() => useDeviceTunnelStore.getState().removeTunnelLink(DEVICE, 'gone'));

    expect(result.current.data?.map((l) => l.slug)).toEqual(['keep']);
    await waitFor(async () =>
      expect((await storedTunnels())?.map((l) => l.slug)).toEqual(['keep']),
    );
  });

  it('stores a created link without the one-shot openUrl token', async () => {
    vi.mocked(deviceService.listTunnels).mockImplementation(pending);
    const { result } = renderHook(() => useFetchDeviceTunnels(DEVICE), { wrapper });

    act(() =>
      useDeviceTunnelStore.getState().addTunnelLink({
        ...link('fresh'),
        openUrl: 'https://3000--fresh.lobe.sh/?token=secret',
      } as DeviceTunnelLink),
    );

    expect(result.current.data?.map((l) => l.slug)).toEqual(['fresh']);
    expect(JSON.stringify(result.current.data)).not.toContain('token=secret');
    await waitFor(async () => expect((await storedTunnels())?.[0]?.slug).toBe('fresh'));
    expect(JSON.stringify(await storedTunnels())).not.toContain('token=secret');
  });

  it('keeps the links on screen when a refresh fails', async () => {
    await seedTunnels([link('cached')]);
    vi.mocked(deviceService.listTunnels).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useFetchDeviceTunnels(DEVICE), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data?.map((l) => l.slug)).toEqual(['cached']);
  });

  it('does not paint another identity’s links', async () => {
    await seedTunnels([link('theirs')]);
    useScope(`tunnel-user-${randomUUID()}:personal`);
    vi.mocked(deviceService.listTunnels).mockImplementation(pending);

    const { result } = renderHook(() => useFetchDeviceTunnels(DEVICE), { wrapper });
    await waitFor(() => expect(deviceService.listTunnels).toHaveBeenCalled());

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it('sends one request for readers mounting together', async () => {
    vi.mocked(deviceService.listTunnels).mockResolvedValue([link('one')]);

    const { result } = renderHook(
      () => [useFetchDeviceTunnels(DEVICE), useFetchDeviceTunnels(DEVICE)],
      { wrapper },
    );

    await waitFor(() => expect(result.current[1].data?.length).toBe(1));
    expect(deviceService.listTunnels).toHaveBeenCalledTimes(1);
  });

  it('keeps the persisted ports unconfirmed when the device cannot answer', async () => {
    await deviceListeningPortsResource.storage!.set(
      { queryKey: deviceListeningPortsResource.storageKey(PORTS), scope },
      { data: { ports: [port(5173)], supported: true }, updatedAt: 1 },
    );
    // `null` is the device failing to answer, not "nothing listens".
    vi.mocked(deviceService.listListeningPorts).mockResolvedValue(null as any);

    const { result } = renderHook(() => useFetchDeviceListeningPorts(DEVICE, '/repo'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isConfirmed).toBe(false);
    expect((await storedPorts())?.ports.map((p) => p.port)).toEqual([5173]);
  });

  it('keys ports by device and directory', async () => {
    await deviceListeningPortsResource.storage!.set(
      { queryKey: deviceListeningPortsResource.storageKey(PORTS), scope },
      { data: { ports: [port(5173)], supported: true }, updatedAt: 1 },
    );
    vi.mocked(deviceService.listListeningPorts).mockImplementation(pending);

    const { result } = renderHook(() => useFetchDeviceListeningPorts(DEVICE, '/other'), {
      wrapper,
    });
    await waitFor(() => expect(deviceService.listListeningPorts).toHaveBeenCalled());

    expect(result.current.data).toBeUndefined();
  });

  it('persists a bounded port list', async () => {
    const ports = Array.from({ length: MAX_PERSISTED_PORTS + 20 }, (_, i) => port(1000 + i));
    vi.mocked(deviceService.listListeningPorts).mockResolvedValue({ ports, supported: true });

    const { result } = renderHook(() => useFetchDeviceListeningPorts(DEVICE, '/repo'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isConfirmed).toBe(true));
    // Memory keeps the whole answer; storage keeps a bounded copy.
    expect(result.current.data?.ports.length).toBe(MAX_PERSISTED_PORTS + 20);
    await waitFor(async () =>
      expect((await storedPorts())?.ports.length).toBe(MAX_PERSISTED_PORTS),
    );
  });
});
