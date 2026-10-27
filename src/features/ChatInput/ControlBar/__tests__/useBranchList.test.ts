/**
 * @vitest-environment happy-dom
 *
 * The branch switcher's list is a replica: after a reload the dropdown paints
 * the branches persisted last session the moment it opens, and the device read
 * only confirms them. Branch writes land in the replica, so the next open never
 * paints a branch that is gone.
 */
import { randomUUID } from 'node:crypto';

import type { DeviceGitBranchListItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage, cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { gitService } from '@/services/git';
import { initialGitStatusState, useGitStatusStore } from '@/store/device/gitStatus/store';

import { useBranchList } from '../useBranchList';
import { useWorktreeBranchSeed } from '../useWorktreeBranchSeed';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('@/services/git', () => ({
  gitService: { listGitBranches: vi.fn() },
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

const branch = (name: string, current = false): DeviceGitBranchListItem => ({ current, name });
const names = (branches: DeviceGitBranchListItem[] | undefined) => branches?.map((b) => b.name);

const DEVICE = 'device-1';
const PATH = '/repo';
/** The persisted row of `deviceId + path`, as the branch-list replica stores it. */
const ROW_KEY = `${DEVICE}\u0000${PATH}`;
const storage = new AppIndexedDBStorage<{ value?: DeviceGitBranchListItem[] }>({
  namespace: 'replica:deviceGitBranchList:v1',
});

describe('useBranchList', () => {
  const scopes = new Set<string>();
  let scope = '';
  const switchScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };
  const seed = (branches: DeviceGitBranchListItem[]) =>
    storage.set({ queryKey: ROW_KEY, scope }, { data: { value: branches }, updatedAt: 1 });
  const stored = async () => names((await storage.get({ queryKey: ROW_KEY, scope }))?.data?.value);

  beforeEach(() => {
    switchScope(`branch-user-${randomUUID()}:personal`);
    act(() => useGitStatusStore.setState(initialGitStatusState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].map((value) => storage.remove({ queryKey: ROW_KEY, scope: value })),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  // Regression: the list lived only in SWR's memory cache, so every reload
  // opened the dropdown on "Loading branches…" until the device answered.
  it('paints the persisted branches the moment it opens, before the device answers', async () => {
    await seed([branch('main', true), branch('feat/cached')]);
    vi.mocked(gitService.listGitBranches).mockImplementation(pending);

    const { result } = renderHook(() => useBranchList(DEVICE, PATH, true), { wrapper });

    await waitFor(() => expect(names(result.current.branches)).toEqual(['main', 'feat/cached']));
    expect(result.current.isLoading).toBe(false);
    expect(gitService.listGitBranches).toHaveBeenCalledWith({ deviceId: DEVICE, path: PATH });
  });

  it('reads nothing while the dropdown is closed', async () => {
    await seed([branch('main', true)]);

    const { result } = renderHook(() => useBranchList(DEVICE, PATH, false), { wrapper });

    expect(result.current.branches).toEqual([]);
    expect(gitService.listGitBranches).not.toHaveBeenCalled();
  });

  it('replaces the persisted list with the device read and persists it', async () => {
    await seed([branch('main', true), branch('feat/old')]);
    vi.mocked(gitService.listGitBranches).mockResolvedValue([
      branch('main', true),
      branch('feat/new'),
    ]);

    const { result } = renderHook(() => useBranchList(DEVICE, PATH, true), { wrapper });

    await waitFor(() => expect(names(result.current.branches)).toEqual(['main', 'feat/new']));
    await waitFor(async () => expect(await stored()).toEqual(['main', 'feat/new']));
  });

  it('re-reads and persists the list after a branch write, even with the dropdown closed', async () => {
    await seed([branch('main', true), branch('feat/gone')]);
    vi.mocked(gitService.listGitBranches).mockResolvedValue([branch('main', true)]);

    const { result } = renderHook(() => useBranchList(DEVICE, PATH, false), { wrapper });
    // e.g. after `deleteGitBranch` succeeded.
    await act(() => result.current.refreshBranches());

    expect(gitService.listGitBranches).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect(await stored()).toEqual(['main']));
  });

  it('keeps the persisted list when the device cannot answer', async () => {
    await seed([branch('main', true), branch('feat/kept')]);
    // The router rejects (BAD_GATEWAY) when the device could not answer.
    vi.mocked(gitService.listGitBranches).mockRejectedValue(
      new Error('The device could not list branches.'),
    );

    const { result } = renderHook(() => useBranchList(DEVICE, PATH, true), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // "Couldn't ask" is not "no branches": the list stays, and so does its row.
    expect(names(result.current.branches)).toEqual(['main', 'feat/kept']);
    expect(result.current.loadFailed).toBe(false);
    expect(await stored()).toEqual(['main', 'feat/kept']);
  });

  // Review P2: an unborn repository really has no branches; that answer must
  // settle the switcher instead of reading as a failure Retry can never fix.
  it('accepts an empty list from the device as an answer', async () => {
    await seed([branch('main', true)]);
    vi.mocked(gitService.listGitBranches).mockResolvedValue([]);

    const { result } = renderHook(() => useBranchList(DEVICE, PATH, true), { wrapper });

    await waitFor(() => expect(result.current.branches).toEqual([]));
    expect(result.current.error).toBeUndefined();
    expect(result.current.loadFailed).toBe(false);
  });

  it('reports a failure with nothing to show as a load failure', async () => {
    vi.mocked(gitService.listGitBranches).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useBranchList(DEVICE, PATH, true), { wrapper });

    await waitFor(() => expect(result.current.loadFailed).toBe(true));
  });

  it('does not paint another identity’s branches', async () => {
    await seed([branch('main', true), branch('theirs')]);
    switchScope(`branch-user-${randomUUID()}:personal`);
    vi.mocked(gitService.listGitBranches).mockImplementation(pending);

    const { result } = renderHook(() => useBranchList(DEVICE, PATH, true), { wrapper });
    await waitFor(() => expect(gitService.listGitBranches).toHaveBeenCalled());

    expect(result.current.branches).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('shares one read between the switcher and the worktree name seed', async () => {
    vi.mocked(gitService.listGitBranches).mockResolvedValue([branch('main', true)]);

    const { result } = renderHook(
      () => ({
        list: useBranchList(DEVICE, PATH, true),
        seed: useWorktreeBranchSeed(DEVICE, PATH),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.seed.isReady).toBe(true));
    expect(names(result.current.list.branches)).toEqual(['main']);
    expect(gitService.listGitBranches).toHaveBeenCalledTimes(1);
  });

  it('draws no worktree name from a persisted list the device has not confirmed', async () => {
    // A branch made since last session would be missing from this list, and a
    // name drawn against it could collide (`refs/heads/wt` blocks `wt/…`).
    await seed([branch('main', true)]);
    vi.mocked(gitService.listGitBranches).mockImplementation(pending);

    const { result } = renderHook(
      () => ({
        list: useBranchList(DEVICE, PATH, true),
        seed: useWorktreeBranchSeed(DEVICE, PATH),
      }),
      { wrapper },
    );
    await waitFor(() => expect(names(result.current.list.branches)).toEqual(['main']));

    expect(result.current.seed.isReady).toBe(false);
    expect(result.current.seed.name).toBeUndefined();
  });
});
