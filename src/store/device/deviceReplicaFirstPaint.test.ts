/**
 * @vitest-environment happy-dom
 *
 * Device reads that used to live only in SWR's memory cache — the base-ref
 * pickers' remote branches, the Ports row's tunnel links and listening ports,
 * and a topic's linked-PR refresh — are replicas: after a reload they paint the
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
import { useChatStore } from '@/store/chat';

import { useFetchGitLinkedPR, useGitRemoteBranches } from './gitHooks';
import { useFetchDeviceListeningPorts, useFetchDeviceTunnels } from './tunnelHooks';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('@/services/git', () => ({
  gitService: {
    getLinkedPullRequest: vi.fn(),
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

  // Review P2: a topic hook that mounts after the composer already fetched the
  // shared row (e.g. hovering a background topic) gets no new response inside
  // the dedupe window; it must still write the confirmed PR back to the topic.
  it('writes a PR the composer already confirmed back to a topic that mounts later', async () => {
    vi.mocked(gitService.getLinkedPullRequest).mockResolvedValue({
      ghMissing: false,
      pullRequest: { number: 9, state: 'open', title: 'feat', url: 'https://x/9' } as any,
      pullRequestStatus: 'ok',
    });
    useChatStore.setState({ activeAgentId: 'agent-1' });
    const metadata = {
      workingDirectory: CWD,
      workingDirectoryConfig: { git: { branch: 'feat/late' }, path: CWD, repoType: 'github' },
    } as any;
    const update = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ internal_updateTopicLinkedPullRequest: update } as any);

    const { result, rerender } = renderHook(
      ({ withTopic }: { withTopic: boolean }) => {
        useChatStore
          .getState()
          .useFetchTopicLinkedPullRequest(withTopic ? 'topic-late' : undefined, metadata);
        return useFetchGitLinkedPR(undefined, CWD, 'feat/late', true);
      },
      { initialProps: { withTopic: false }, wrapper },
    );
    await waitFor(() => expect(result.current.data?.pullRequest?.number).toBe(9));
    expect(update).not.toHaveBeenCalled();

    rerender({ withTopic: true });

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toMatchObject({ branch: 'feat/late', topicId: 'topic-late' });
    expect(update.mock.calls[0][1]).toMatchObject({ pullRequest: { number: 9 } });
    expect(gitService.getLinkedPullRequest).toHaveBeenCalledTimes(1);
  });

  // Regression: the topic refresh and the composer's lookup used the same SWR
  // key with different fetchers and value shapes, so whichever ran first owned
  // the cache — and each still sent its own `gh pr list`.
  it('shares one linked-PR read between a topic refresh and the composer', async () => {
    vi.mocked(gitService.getLinkedPullRequest).mockResolvedValue({
      ghMissing: false,
      pullRequest: { number: 7, state: 'open', title: 'feat', url: 'https://x/7' } as any,
      pullRequestStatus: 'ok',
    });
    useChatStore.setState({ activeAgentId: 'agent-1' });
    const metadata = {
      workingDirectory: CWD,
      workingDirectoryConfig: { git: { branch: 'feat/x' }, path: CWD, repoType: 'github' },
    } as any;
    const update = vi
      .spyOn(useChatStore.getState(), 'internal_updateTopicLinkedPullRequest')
      .mockResolvedValue();
    useChatStore.setState({ internal_updateTopicLinkedPullRequest: update } as any);

    const { result } = renderHook(
      () => {
        useChatStore.getState().useFetchTopicLinkedPullRequest('topic-1', metadata);
        return useFetchGitLinkedPR(undefined, CWD, 'feat/x', true);
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.data?.pullRequest?.number).toBe(7));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ pullRequest: { number: 7 } });
    expect(gitService.getLinkedPullRequest).toHaveBeenCalledTimes(1);
  });
});
