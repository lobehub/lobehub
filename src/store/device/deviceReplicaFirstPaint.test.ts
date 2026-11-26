/**
 * @vitest-environment happy-dom
 *
 * Device reads that used to live only in SWR's memory cache — the base-ref
 * pickers' remote branches, and the Ports row's tunnel links and listening
 * ports — are replicas: after a reload they paint the
 * persisted copy before the device answers, and the answer replaces it.
 */
import { randomUUID } from 'node:crypto';

import type { DeviceListeningPortsResult } from '@lobechat/types';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage, cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { deviceService } from '@/services/device';
import { gitService } from '@/services/git';

import { useGitRemoteBranches } from './gitHooks';
import { useFetchDeviceListeningPorts, useFetchDeviceTunnels } from './tunnelHooks';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('@/services/git', () => ({
  gitService: {
    listGitRemoteBranches: vi.fn(),
  },
}));

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

/** Never-resolving read: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const DEVICE = 'device-1';
const CWD = '/repo';

const remoteBranchStorage = new AppIndexedDBStorage<{ value?: unknown }>({
  namespace: 'replica:deviceGitRemoteBranchList:v1',
});
const tunnelStorage = new AppIndexedDBStorage<unknown[]>({
  namespace: 'replica:deviceTunnelLinks:v1',
});
const portStorage = new AppIndexedDBStorage<DeviceListeningPortsResult>({
  namespace: 'replica:deviceListeningPorts:v1',
});

const REMOTE_BRANCH_ROW = `${DEVICE}\u0000${CWD}`;
const TUNNEL_ROW = DEVICE;
const PORT_ROW = `${DEVICE}\u0000${CWD}`;

const link = {
  createdAt: 1,
  deviceId: DEVICE,
  hostname: '3000--abcdefgh.lobe.sh',
  port: 3000,
  slug: 'abcdefgh',
  url: 'https://3000--abcdefgh.lobe.sh/',
};

const port = (value: number) => ({
  command: 'node',
  inProject: true,
  loopback: 'both' as const,
  port: value,
});

describe('device replicas paint from storage first', () => {
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
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) => [
        remoteBranchStorage.remove({ queryKey: REMOTE_BRANCH_ROW, scope: value }),
        tunnelStorage.remove({ queryKey: TUNNEL_ROW, scope: value }),
        portStorage.remove({ queryKey: PORT_ROW, scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted remote branches when a base-ref picker opens', async () => {
    await remoteBranchStorage.set(
      { queryKey: REMOTE_BRANCH_ROW, scope },
      { data: { value: [{ name: 'origin/main' }, { name: 'origin/cached' }] }, updatedAt: 1 },
    );
    vi.mocked(gitService.listGitRemoteBranches).mockImplementation(pending);

    const { result } = renderHook(() => useGitRemoteBranches(CWD, true, DEVICE), { wrapper });

    await waitFor(() =>
      expect(result.current.data?.map((b) => b.name)).toEqual(['origin/main', 'origin/cached']),
    );
    expect(gitService.listGitRemoteBranches).toHaveBeenCalledWith({ deviceId: DEVICE, path: CWD });
  });

  // Review P2: a gateway outage used to arrive as `[]` and replace the cached list;
  // it now rejects, and the replica keeps its copy.
  it('keeps the persisted remote branches when the device cannot answer', async () => {
    await remoteBranchStorage.set(
      { queryKey: REMOTE_BRANCH_ROW, scope },
      { data: { value: [{ name: 'origin/main' }] }, updatedAt: 1 },
    );
    vi.mocked(gitService.listGitRemoteBranches).mockRejectedValue(
      new Error('The device could not list remote branches.'),
    );

    const { result } = renderHook(() => useGitRemoteBranches(CWD, true, DEVICE), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data?.map((b) => b.name)).toEqual(['origin/main']);
    expect((await remoteBranchStorage.get({ queryKey: REMOTE_BRANCH_ROW, scope }))?.data).toEqual({
      value: [{ name: 'origin/main' }],
    });
  });

  it('paints the persisted tunnel links, then the server list replaces them', async () => {
    await tunnelStorage.set({ queryKey: TUNNEL_ROW, scope }, { data: [link], updatedAt: 1 });
    let answer!: (links: unknown[]) => void;
    vi.mocked(deviceService.listTunnels).mockImplementation(
      () => new Promise((resolve) => (answer = resolve as any)) as any,
    );

    const { result } = renderHook(() => useFetchDeviceTunnels(DEVICE), { wrapper });

    await waitFor(() => expect(result.current.data?.map((l) => l.slug)).toEqual(['abcdefgh']));
    expect(result.current.isLoading).toBe(false);

    answer([{ ...link, port: 5173, slug: 'fresh' }]);
    await waitFor(() => expect(result.current.data?.map((l) => l.slug)).toEqual(['fresh']));
  });

  it('paints the persisted ports as unconfirmed until the device answers', async () => {
    await portStorage.set(
      { queryKey: PORT_ROW, scope },
      { data: { ports: [port(5173)], supported: true }, updatedAt: 1 },
    );
    let answer!: (result: DeviceListeningPortsResult) => void;
    vi.mocked(deviceService.listListeningPorts).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as any,
    );

    const { result } = renderHook(() => useFetchDeviceListeningPorts(DEVICE, CWD), { wrapper });

    await waitFor(() => expect(result.current.data?.ports.map((p) => p.port)).toEqual([5173]));
    // Whether 5173 still listens is unknown until this session's probe answers.
    expect((result.current as { isConfirmed?: boolean }).isConfirmed).toBe(false);

    answer({ ports: [port(3000)], supported: true });
    await waitFor(() => expect(result.current.data?.ports.map((p) => p.port)).toEqual([3000]));
    expect((result.current as { isConfirmed?: boolean }).isConfirmed).toBe(true);
  });
});
