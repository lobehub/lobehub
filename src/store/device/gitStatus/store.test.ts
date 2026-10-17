/**
 * @vitest-environment happy-dom
 *
 * The Overview / chat-input git reads are replicas: after a reload the last
 * branch, ahead/behind counts, dirty counts and worktrees paint from the
 * persisted copy on the first frame, and the device read only confirms them.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { CACHE_TIERS } from '@/libs/swr/localStorageProvider';
import { setScopedMutate } from '@/libs/swr/mutate';
import { gitService } from '@/services/git';

import {
  useFetchGitAheadBehind,
  useFetchGitBranch,
  useFetchGitDiffStats,
  useFetchGitWorkingTreeStatus,
  useFetchGitWorktrees,
} from '../gitHooks';
import {
  gitAheadBehindResource,
  gitBranchResource,
  gitDiffStatsResource,
  gitStatusKey,
  gitWorkingTreeStatusResource,
  gitWorktreesResource,
} from './projection';
import { initialGitStatusState, useGitStatusStore } from './store';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('@/services/git', () => ({
  gitService: {
    getGitAheadBehind: vi.fn(),
    getGitBranch: vi.fn(),
    getGitWorkingTreeStatus: vi.fn(),
    listGitWorktrees: vi.fn(),
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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const RESOURCES = [
  gitBranchResource,
  gitAheadBehindResource,
  gitDiffStatsResource,
  gitWorkingTreeStatusResource,
  gitWorktreesResource,
] as const;

const REMOTE = { deviceId: 'device-1', path: '/repo' };
const LOCAL = { deviceId: undefined, path: '/repo' };

describe('git status replicas', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };
  const seed = (resource: (typeof RESOURCES)[number], params: typeof REMOTE, data: unknown) =>
    resource.storage!.set(
      { queryKey: resource.storageKey(params), scope },
      { data: { value: data } as any, updatedAt: 1 },
    );

  beforeEach(() => {
    useScope(`git-user-${randomUUID()}:personal`);
    act(() => useGitStatusStore.setState(initialGitStatusState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        RESOURCES.flatMap((resource) =>
          [REMOTE, LOCAL].map((params) =>
            resource.storage!.remove({ queryKey: resource.storageKey(params), scope: value }),
          ),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  // Regression: these reads lived only in SWR's memory cache, so after a reload
  // the Overview showed a skeleton and the chat-input branch chip popped in.
  it('paints every persisted git read before the device answers', async () => {
    await Promise.all([
      seed(gitBranchResource, REMOTE, { branch: 'feat/cached', detached: false }),
      seed(gitAheadBehindResource, REMOTE, { ahead: 2, behind: 0 }),
      seed(gitWorkingTreeStatusResource, REMOTE, { added: 0, deleted: 0, modified: 2 }),
      seed(gitWorktreesResource, REMOTE, [{ branch: 'feat/wt', path: '/repo-wt' }]),
    ]);
    vi.mocked(gitService.getGitBranch).mockImplementation(pending);
    vi.mocked(gitService.getGitAheadBehind).mockImplementation(pending);
    vi.mocked(gitService.getGitWorkingTreeStatus).mockImplementation(pending);
    vi.mocked(gitService.listGitWorktrees).mockImplementation(pending);

    const { result } = renderHook(
      () => ({
        aheadBehind: useFetchGitAheadBehind('device-1', '/repo'),
        branch: useFetchGitBranch('device-1', '/repo'),
        status: useFetchGitWorkingTreeStatus('device-1', '/repo'),
        worktrees: useFetchGitWorktrees('device-1', '/repo'),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.branch.data?.branch).toBe('feat/cached'));
    expect(result.current.aheadBehind.data).toMatchObject({ ahead: 2 });
    expect(result.current.status.data).toMatchObject({ modified: 2 });
    expect(result.current.worktrees.data).toEqual([{ branch: 'feat/wt', path: '/repo-wt' }]);
    // A persisted row is something to paint: no skeleton while the read is pending.
    expect(result.current.branch.isLoading).toBe(false);
    expect(result.current.branch.isValidating).toBe(true);
    // …but it is NOT confirmation: this session's probe has not answered yet, so
    // checkout / pull / push and the dead-directory hand-off stay gated.
    expect(result.current.branch.isConfirmed).toBe(false);
    expect(gitService.getGitBranch).toHaveBeenCalledWith(REMOTE);
  });

  it('confirms a hydrated row only once the probe answers, including an empty answer', async () => {
    await seed(gitBranchResource, REMOTE, { branch: 'feat/cached', detached: false });
    // `{}` is what `getGitBranch` resolves for a path it cannot read: an answer,
    // and the only thing allowed to declare the directory gone.
    vi.mocked(gitService.getGitBranch).mockResolvedValue({});

    const { result } = renderHook(() => useFetchGitBranch('device-1', '/repo'), { wrapper });

    await waitFor(() => expect(result.current.isConfirmed).toBe(true));
    expect(result.current.data).toEqual({});
    expect(result.current.isLoading).toBe(false);
  });

  it('replaces the persisted row with the device read and persists the new value', async () => {
    await seed(gitBranchResource, LOCAL, { branch: 'old' });
    vi.mocked(gitService.getGitBranch).mockResolvedValue({ branch: 'new', detached: false });

    const { result } = renderHook(() => useFetchGitBranch(undefined, '/repo'), { wrapper });

    await waitFor(() => expect(result.current.data?.branch).toBe('new'));
    expect(result.current.isConfirmed).toBe(true);
    await waitFor(async () =>
      expect(
        (
          await gitBranchResource.storage!.get({
            queryKey: gitBranchResource.storageKey(LOCAL),
            scope,
          })
        )?.data,
      ).toEqual({ value: { branch: 'new', detached: false } }),
    );
  });

  it('keys rows by device and path, so another device never paints this one', async () => {
    await seed(gitBranchResource, REMOTE, { branch: 'remote-branch' });
    vi.mocked(gitService.getGitBranch).mockImplementation(pending);

    const { result } = renderHook(() => useFetchGitBranch(undefined, '/repo'), { wrapper });
    // Let the (empty) local hydrate settle.
    await waitFor(() => expect(gitService.getGitBranch).toHaveBeenCalledWith(LOCAL));

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
    expect(gitStatusKey(REMOTE)).not.toBe(gitStatusKey(LOCAL));
  });

  it('does not paint another identity’s rows', async () => {
    await seed(gitBranchResource, REMOTE, { branch: 'theirs' });
    useScope(`git-user-${randomUUID()}:personal`);
    vi.mocked(gitService.getGitBranch).mockImplementation(pending);

    const { result } = renderHook(() => useFetchGitBranch('device-1', '/repo'), { wrapper });
    await waitFor(() => expect(gitService.getGitBranch).toHaveBeenCalled());

    expect(result.current.data).toBeUndefined();
  });

  it('does not paint the same user’s rows from another workspace', async () => {
    await seed(gitBranchResource, REMOTE, { branch: 'workspace-one' });
    useScope(scope.replace(':personal', ':workspace-two'));
    vi.mocked(gitService.getGitBranch).mockImplementation(pending);

    const { result } = renderHook(() => useFetchGitBranch('device-1', '/repo'), { wrapper });
    await waitFor(() => expect(gitService.getGitBranch).toHaveBeenCalled());

    expect(result.current.data).toBeUndefined();
  });

  it('lets an empty answer replace a stale persisted row', async () => {
    await seed(gitAheadBehindResource, REMOTE, { ahead: 5, behind: 1 });
    vi.mocked(gitService.getGitAheadBehind).mockResolvedValue(undefined);

    const { result } = renderHook(() => useFetchGitAheadBehind('device-1', '/repo'), {
      wrapper,
    });

    await waitFor(() =>
      expect(useGitStatusStore.getState().gitAheadBehindMap[gitStatusKey(REMOTE)]).toEqual({}),
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('writes an optimistic branch through mutate without refetching, and never persists it', async () => {
    await seed(gitBranchResource, REMOTE, { branch: 'main', detached: false });
    vi.mocked(gitService.getGitBranch).mockResolvedValue({ branch: 'main', detached: false });
    const { result } = renderHook(() => useFetchGitBranch('device-1', '/repo'), { wrapper });
    await waitFor(() => expect(result.current.data?.branch).toBe('main'));
    vi.mocked(gitService.getGitBranch).mockClear();

    await act(() =>
      result.current.mutate({ branch: 'feat/x', detached: false }, { revalidate: false }),
    );

    expect(result.current.data?.branch).toBe('feat/x');
    expect(gitService.getGitBranch).not.toHaveBeenCalled();

    // Review P2: an optimistic checkout value must stay in memory. If the
    // checkout fails — or the renderer closes before `onAfterCheckout` runs —
    // the next launch has to paint the confirmed branch, not `feat/x`.
    expect(
      (
        await gitBranchResource.storage!.get({
          queryKey: gitBranchResource.storageKey(REMOTE),
          scope,
        })
      )?.data,
    ).toEqual({ value: { branch: 'main', detached: false } });
  });

  // Review P2: a read that started before the checkout must not repaint the old
  // branch. The optimistic write is an overlay (rebased onto server responses),
  // not a confirmed write that an older response can overwrite.
  it('keeps an optimistic branch when a read that started earlier answers', async () => {
    await seed(gitBranchResource, REMOTE, { branch: 'main', detached: false });
    const read = deferred<{ branch: string; detached: boolean }>();
    vi.mocked(gitService.getGitBranch).mockReturnValue(read.promise);

    const { result } = renderHook(() => useFetchGitBranch('device-1', '/repo'), { wrapper });
    await waitFor(() => expect(result.current.data?.branch).toBe('main'));
    await waitFor(() => expect(gitService.getGitBranch).toHaveBeenCalledTimes(1));

    await act(() =>
      result.current.mutate({ branch: 'feat/x', detached: false }, { revalidate: false }),
    );
    expect(result.current.data?.branch).toBe('feat/x');

    // The pre-checkout read settles with the old branch.
    await act(async () => {
      read.resolve({ branch: 'main', detached: false });
      await read.promise;
    });

    expect(result.current.data?.branch).toBe('feat/x');
    // …and still nothing about the checkout reached persistent storage.
    expect(
      (
        await gitBranchResource.storage!.get({
          queryKey: gitBranchResource.storageKey(REMOTE),
          scope,
        })
      )?.data,
    ).toEqual({ value: { branch: 'main', detached: false } });
  });

  // The composer's `+N −M` chip is derived from review patches; only its compact
  // counts are persisted, so a reload paints the chip instead of growing the
  // cluster when the diff arrives.
  it('paints persisted diff counts and persists a confirmed write', async () => {
    await seed(gitDiffStatsResource, REMOTE, { additions: 4, deletions: 2, files: 2 });
    const { result } = renderHook(() => useFetchGitDiffStats('device-1', '/repo'), { wrapper });

    await waitFor(() =>
      expect(result.current.data).toEqual({ additions: 4, deletions: 2, files: 2 }),
    );
    act(() => result.current.set({ additions: 0, deletions: 0, files: 0 }));
    expect(result.current.data).toEqual({ additions: 0, deletions: 0, files: 0 });
    await waitFor(async () =>
      expect(
        (
          await gitDiffStatsResource.storage!.get({
            queryKey: gitDiffStatsResource.storageKey(REMOTE),
            scope,
          })
        )?.data,
      ).toEqual({ value: { additions: 0, deletions: 0, files: 0 } }),
    );
  });

  // Review P1: the settlement after a checkout must roll back to the confirmed
  // base. Committing would re-apply the optimistic branch to the base, so a
  // failed checkout would be persisted as if it had landed.
  it('rolls the optimistic branch back when the probe still reports the old branch', async () => {
    await seed(gitBranchResource, REMOTE, { branch: 'main', detached: false });
    vi.mocked(gitService.getGitBranch).mockResolvedValue({ branch: 'main', detached: false });
    const { result } = renderHook(() => useFetchGitBranch('device-1', '/repo'), { wrapper });
    await waitFor(() => expect(result.current.data?.branch).toBe('main'));

    await act(() =>
      result.current.mutate({ branch: 'feat/x', detached: false }, { revalidate: false }),
    );
    expect(result.current.data?.branch).toBe('feat/x');

    // `onAfterCheckout` revalidates regardless of success; the probe answers
    // with the branch that is actually checked out.
    await act(() => result.current.mutate());
    expect(result.current.data?.branch).toBe('main');
    expect(
      (
        await gitBranchResource.storage!.get({
          queryKey: gitBranchResource.storageKey(REMOTE),
          scope,
        })
      )?.data,
    ).toEqual({ value: { branch: 'main', detached: false } });
  });

  it('keeps the new branch once the probe confirms it', async () => {
    await seed(gitBranchResource, REMOTE, { branch: 'main', detached: false });
    vi.mocked(gitService.getGitBranch).mockResolvedValue({ branch: 'main', detached: false });
    const { result } = renderHook(() => useFetchGitBranch('device-1', '/repo'), { wrapper });
    await waitFor(() => expect(result.current.data?.branch).toBe('main'));

    await act(() =>
      result.current.mutate({ branch: 'feat/x', detached: false }, { revalidate: false }),
    );
    vi.mocked(gitService.getGitBranch).mockResolvedValue({ branch: 'feat/x', detached: false });

    await act(() => result.current.mutate());
    await waitFor(() => expect(result.current.data?.branch).toBe('feat/x'));
    expect(
      (
        await gitBranchResource.storage!.get({
          queryKey: gitBranchResource.storageKey(REMOTE),
          scope,
        })
      )?.data,
    ).toEqual({ value: { branch: 'feat/x', detached: false } });
  });

  it('revalidates the mounted reads of a directory', async () => {
    vi.mocked(gitService.getGitAheadBehind).mockResolvedValue({ ahead: 0, behind: 0 } as any);
    const { result } = renderHook(() => useFetchGitAheadBehind('device-1', '/repo'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toMatchObject({ ahead: 0 }));

    vi.mocked(gitService.getGitAheadBehind).mockResolvedValue({ ahead: 3, behind: 0 } as any);
    await act(() =>
      useGitStatusStore.getState().revalidateGitStatus('device-1', '/repo', ['aheadBehind']),
    );

    await waitFor(() => expect(result.current.data).toMatchObject({ ahead: 3 }));
  });

  // The persistence moved to replicas: the SWR cache tiers must not also keep it.
  it('is not persisted by the SWR cache layer', () => {
    const patterns = [...CACHE_TIERS.idb, ...CACHE_TIERS.local];
    for (const name of ['gitBranch', 'gitAheadBehind', 'gitWorkingTreeStatus', 'gitWorktrees']) {
      expect(patterns.some((pattern) => pattern.includes(name))).toBe(false);
    }
  });
});
