/**
 * @vitest-environment happy-dom
 *
 * The Review / Pull Request tab reads are replicas: after a reload the last
 * file list (paths + counts, no diff text) and the last PR detail / activity /
 * merge context / linked PR paint from the persisted copy on the first frame,
 * and the device read only confirms them.
 */
import { randomUUID } from 'node:crypto';

import type { GitWorkingTreePatch } from '@lobechat/electron-client-ipc';
import type { DeviceGitPullRequestDetailResult } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, type ReplicaResource } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { gitService } from '@/services/git';

import {
  invalidateGitReviewCaches,
  useFetchGitLinkedPR,
  useFetchGitPullRequestActivity,
  useFetchGitPullRequestDetail,
  useFetchGitPullRequestMergeContext,
  useReviewPatches,
} from '../gitHooks';
import {
  getReviewSummaryState,
  GIT_REVIEW_MAX_PERSISTED_BYTES,
  gitLinkedPRKey,
  gitLinkedPRResource,
  gitPullRequestActivityResource,
  gitPullRequestDetailResource,
  gitPullRequestKey,
  gitPullRequestMergeContextResource,
  gitReviewPatchesResource,
  type ReviewPatchesData,
} from './projection';
import { initialGitReviewState, useGitReviewStore } from './store';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('@/services/git', () => ({
  gitService: {
    getGitBranchDiff: vi.fn(),
    getGitWorkingTreePatches: vi.fn(),
    getLinkedPullRequest: vi.fn(),
    getPullRequestActivity: vi.fn(),
    getPullRequestDetail: vi.fn(),
    getPullRequestMergeContext: vi.fn(),
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

const patch = (filePath: string, body: string): GitWorkingTreePatch => ({
  additions: 3,
  deletions: 1,
  filePath,
  isBinary: false,
  patch: body,
  status: 'modified',
  truncated: false,
});

const detailResult: DeviceGitPullRequestDetailResult = {
  detail: {
    additions: 10,
    author: 'octocat',
    baseBehindBy: 0,
    baseRefName: 'canary',
    body: 'cached description',
    changedFiles: 2,
    checks: [{ name: 'ci', required: true, status: 'success' }],
    comments: [],
    commits: [],
    deletions: 2,
    headRefName: 'feat/x',
    headRefOid: 'a'.repeat(40),
    isCrossRepository: false,
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    number: 42,
    repo: { name: 'repo', owner: 'octocat' },
    reviewDecision: null,
    reviews: [],
    state: 'open',
    title: 'Cached PR title',
    url: 'https://github.com/octocat/repo/pull/42',
    viewerCanBypass: false,
    viewerCanWrite: true,
  },
  status: 'ok',
};

const REVIEW = {
  baseRef: undefined,
  deviceId: 'device-1',
  mode: 'unstaged' as const,
  path: '/repo',
};
const PR = { deviceId: 'device-1', number: 42, path: '/repo' };
const LINKED = { branch: 'feat/x', deviceId: 'device-1', path: '/repo' };
const MERGE = {
  ...PR,
  baseRefName: 'canary',
  headRefOid: 'a'.repeat(40),
  repo: { name: 'repo', owner: 'octocat' },
};

type AnyResource = ReplicaResource<any, any, any>;

describe('Review / PR tab replicas', () => {
  const scopes = new Set<string>();
  const written: { params: unknown; resource: AnyResource }[] = [];
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };
  const seed = (resource: AnyResource, params: unknown, data: unknown) => {
    written.push({ params, resource });
    return resource.storage!.set(
      { queryKey: resource.storageKey(params), scope },
      { data, updatedAt: 1 },
    );
  };
  const readRow = async (resource: AnyResource, params: unknown) => {
    written.push({ params, resource });
    return (await resource.storage!.get({ queryKey: resource.storageKey(params), scope }))?.data;
  };

  beforeEach(() => {
    useScope(`git-review-user-${randomUUID()}:personal`);
    act(() => useGitReviewStore.setState(initialGitReviewState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        written.map(({ params, resource }) =>
          resource.storage!.remove({ queryKey: resource.storageKey(params), scope: value }),
        ),
      ),
    );
    scopes.clear();
    written.length = 0;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('Review tab', () => {
    // Regression: the diff lived only in SWR's memory cache, so after a reload
    // the Review tab showed a full-panel spinner until git answered.
    it('paints the persisted file summary before the device answers', async () => {
      await seed(gitReviewPatchesResource, REVIEW, {
        mode: 'unstaged',
        patches: [patch('src/a.ts', ''), patch('src/b.ts', '')],
        summaryOnly: true,
      } satisfies ReviewPatchesData);
      vi.mocked(gitService.getGitWorkingTreePatches).mockImplementation(pending);

      const { result } = renderHook(
        () => useReviewPatches('/repo', 'unstaged', undefined, 'device-1'),
        { wrapper },
      );

      await waitFor(() => expect(result.current.data?.patches).toHaveLength(2));
      expect(result.current.data?.summaryOnly).toBe(true);
      expect(result.current.data?.patches.map((p) => p.filePath)).toEqual(['src/a.ts', 'src/b.ts']);
      // Something to paint: no spinner while the live read is pending.
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isValidating).toBe(true);
    });

    // Regression: with a persisted summary and a failed live read (offline
    // device), expanded rows kept their loading placeholder forever.
    it('stops treating summary rows as pending once the live read fails', async () => {
      await seed(gitReviewPatchesResource, REVIEW, {
        mode: 'unstaged',
        patches: [patch('src/a.ts', '')],
        summaryOnly: true,
      } satisfies ReviewPatchesData);
      vi.mocked(gitService.getGitWorkingTreePatches).mockRejectedValue(new Error('offline'));

      const { result } = renderHook(
        () => useReviewPatches('/repo', 'unstaged', undefined, 'device-1'),
        { wrapper },
      );

      await waitFor(() => expect(result.current.error).toBeTruthy());
      expect(result.current.isValidating).toBe(false);
      expect(result.current.data?.summaryOnly).toBe(true);
      expect(getReviewSummaryState(result.current.data, result.current.error)).toEqual({
        diffPending: false,
        // Still unconfirmed: revert stays disabled.
        isSummary: true,
      });
    });

    // Regression: an offline remote device resolves the patch read to
    // `undefined`; it was turned into an empty working tree, so Review claimed
    // "no changes" and overwrote the persisted summary.
    it.each([
      ['unstaged', 'getGitWorkingTreePatches'],
      ['branch', 'getGitBranchDiff'],
    ] as const)(
      'keeps the persisted %s summary when the device read is unknown',
      async (mode, method) => {
        const params = { ...REVIEW, mode };
        const summary = {
          mode,
          patches: [patch('src/a.ts', '')],
          summaryOnly: true,
        } satisfies ReviewPatchesData;
        await seed(gitReviewPatchesResource, params, summary);
        vi.mocked(gitService[method]).mockResolvedValue(undefined);

        const { result } = renderHook(
          () => useReviewPatches('/repo', mode, undefined, 'device-1'),
          { wrapper },
        );

        await waitFor(() => expect(result.current.error).toBeTruthy());
        expect(result.current.data?.patches.map((p) => p.filePath)).toEqual(['src/a.ts']);
        expect(await readRow(gitReviewPatchesResource, params)).toEqual(summary);
      },
    );

    it('treats summary rows as pending only while the live read can still land', () => {
      const summary = { mode: 'unstaged', patches: [], summaryOnly: true } as ReviewPatchesData;
      expect(getReviewSummaryState(summary, undefined)).toEqual({
        diffPending: true,
        isSummary: true,
      });
      expect(getReviewSummaryState({ mode: 'unstaged', patches: [] }, undefined)).toEqual({
        diffPending: false,
        isSummary: false,
      });
      expect(getReviewSummaryState(undefined, new Error('offline'))).toEqual({
        diffPending: false,
        isSummary: false,
      });
    });

    it('replaces the summary with the live diff, and persists only the diff-free summary', async () => {
      await seed(gitReviewPatchesResource, REVIEW, {
        mode: 'unstaged',
        patches: [patch('src/old.ts', '')],
        summaryOnly: true,
      });
      vi.mocked(gitService.getGitWorkingTreePatches).mockResolvedValue({
        patches: [patch('src/a.ts', '@@ -1 +1 @@\n-old\n+new')],
      } as any);

      const { result } = renderHook(
        () => useReviewPatches('/repo', 'unstaged', undefined, 'device-1'),
        { wrapper },
      );

      await waitFor(() => expect(result.current.data?.patches[0]?.patch).toContain('+new'));
      expect(result.current.data?.summaryOnly).toBeUndefined();
      await waitFor(async () =>
        expect(await readRow(gitReviewPatchesResource, REVIEW)).toEqual({
          baseRef: undefined,
          headRef: undefined,
          mode: 'unstaged',
          patches: [patch('src/a.ts', '')],
          submodules: undefined,
          summaryOnly: true,
        }),
      );
    });

    it('keeps an outsized summary memory-only and drops the older row', async () => {
      await seed(gitReviewPatchesResource, REVIEW, {
        mode: 'unstaged',
        patches: [patch('src/old.ts', '')],
        summaryOnly: true,
      });
      const longPath = 'x'.repeat(1024);
      const count = Math.ceil(GIT_REVIEW_MAX_PERSISTED_BYTES / 1024) + 1;
      vi.mocked(gitService.getGitWorkingTreePatches).mockResolvedValue({
        patches: Array.from({ length: count }, (_, i) => patch(`${i}/${longPath}`, '+x')),
      } as any);

      const { result } = renderHook(
        () => useReviewPatches('/repo', 'unstaged', undefined, 'device-1'),
        { wrapper },
      );

      await waitFor(() => expect(result.current.data?.patches).toHaveLength(count));
      await waitFor(async () =>
        expect(await readRow(gitReviewPatchesResource, REVIEW)).toBeUndefined(),
      );
    });

    it('keys rows by device, so another device never paints this one', async () => {
      await seed(gitReviewPatchesResource, REVIEW, {
        mode: 'unstaged',
        patches: [patch('src/remote.ts', '')],
        summaryOnly: true,
      });
      vi.mocked(gitService.getGitWorkingTreePatches).mockImplementation(pending);

      const { result } = renderHook(() => useReviewPatches('/repo', 'unstaged'), { wrapper });
      await waitFor(() => expect(gitService.getGitWorkingTreePatches).toHaveBeenCalled());

      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(true);
    });

    it('does not paint another identity’s rows', async () => {
      await seed(gitReviewPatchesResource, REVIEW, {
        mode: 'unstaged',
        patches: [patch('src/theirs.ts', '')],
        summaryOnly: true,
      });
      useScope(`git-review-user-${randomUUID()}:personal`);
      vi.mocked(gitService.getGitWorkingTreePatches).mockImplementation(pending);

      const { result } = renderHook(
        () => useReviewPatches('/repo', 'unstaged', undefined, 'device-1'),
        { wrapper },
      );
      await waitFor(() => expect(gitService.getGitWorkingTreePatches).toHaveBeenCalled());

      expect(result.current.data).toBeUndefined();
    });

    it('re-reads through the existing invalidation helper', async () => {
      vi.mocked(gitService.getGitWorkingTreePatches).mockResolvedValue({
        patches: [patch('src/a.ts', '+1')],
      } as any);
      const { result } = renderHook(
        () => useReviewPatches('/repo', 'unstaged', undefined, 'device-1'),
        { wrapper },
      );
      await waitFor(() => expect(result.current.data?.patches).toHaveLength(1));

      vi.mocked(gitService.getGitWorkingTreePatches).mockResolvedValue({
        patches: [patch('src/a.ts', '+1'), patch('src/b.ts', '+2')],
      } as any);
      await act(() =>
        invalidateGitReviewCaches({ deviceId: 'device-1', dirPath: '/repo', mode: 'unstaged' }),
      );

      await waitFor(() => expect(result.current.data?.patches).toHaveLength(2));
    });
  });

  describe('Pull Request tab', () => {
    // Regression: the PR reads lived only in SWR's memory cache, so after a
    // reload the PR tab body was a skeleton until `gh pr view` answered again.
    it('paints the persisted linked PR, detail, activity and merge context before gh answers', async () => {
      await Promise.all([
        seed(gitLinkedPRResource, LINKED, {
          value: {
            pullRequest: { number: 42, state: 'open', title: 'Cached PR title', url: 'u' },
            pullRequestStatus: 'ok',
          },
        }),
        seed(gitPullRequestDetailResource, PR, { value: detailResult }),
        seed(gitPullRequestActivityResource, PR, {
          value: { comments: [{ author: 'a', body: 'cached comment' }], commits: [], reviews: [] },
        }),
        seed(gitPullRequestMergeContextResource, MERGE, {
          value: {
            baseBehindBy: 0,
            requiredChecks: ['ci'],
            viewerCanBypass: false,
            viewerCanWrite: true,
          },
        }),
      ]);
      vi.mocked(gitService.getLinkedPullRequest).mockImplementation(pending);
      vi.mocked(gitService.getPullRequestDetail).mockImplementation(pending);
      vi.mocked(gitService.getPullRequestActivity).mockImplementation(pending);
      vi.mocked(gitService.getPullRequestMergeContext).mockImplementation(pending);

      const { result } = renderHook(
        () => {
          const linked = useFetchGitLinkedPR('device-1', '/repo', 'feat/x', true);
          const detail = useFetchGitPullRequestDetail('device-1', '/repo', 42);
          const activity = useFetchGitPullRequestActivity('device-1', '/repo', 42);
          const context = useFetchGitPullRequestMergeContext(
            'device-1',
            '/repo',
            detail.data?.detail ?? undefined,
          );
          return { activity, context, detail, linked };
        },
        { wrapper },
      );

      await waitFor(() =>
        expect(result.current.detail.data?.detail?.title).toBe('Cached PR title'),
      );
      expect(result.current.detail.isLoading).toBe(false);
      expect(result.current.detail.isValidating).toBe(true);
      expect(result.current.linked.data?.pullRequest?.number).toBe(42);
      await waitFor(() =>
        expect(result.current.activity.data?.comments[0]?.body).toBe('cached comment'),
      );
      await waitFor(() => expect(result.current.context.data?.requiredChecks).toEqual(['ci']));
      expect(gitService.getPullRequestDetail).toHaveBeenCalledWith({ ...PR, coreOnly: true });
    });

    // Regression: the PR tab mounts once the linked PR is known, and its own
    // hydration then read the detail from storage — a skeleton frame in between.
    it('reads the PR detail and activity from storage once the linked PR hydrates', async () => {
      await Promise.all([
        seed(gitLinkedPRResource, LINKED, {
          value: {
            pullRequest: { number: 42, state: 'open', title: 'Cached PR title', url: 'u' },
            pullRequestStatus: 'ok',
          },
        }),
        seed(gitPullRequestDetailResource, PR, { value: detailResult }),
        seed(gitPullRequestActivityResource, PR, {
          value: { comments: [{ author: 'a', body: 'cached comment' }], commits: [], reviews: [] },
        }),
      ]);
      vi.mocked(gitService.getLinkedPullRequest).mockImplementation(pending);

      // Only the linked-PR read is mounted: the PR tab is not rendered yet.
      renderHook(() => useFetchGitLinkedPR('device-1', '/repo', 'feat/x', true), { wrapper });

      const key = gitPullRequestKey(PR);
      await waitFor(() =>
        expect(
          useGitReviewStore.getState().gitPullRequestDetailMap[key]?.value?.detail?.title,
        ).toBe('Cached PR title'),
      );
      await waitFor(() =>
        expect(
          useGitReviewStore.getState().gitPullRequestActivityMap[key]?.value?.comments[0]?.body,
        ).toBe('cached comment'),
      );
      expect(gitService.getPullRequestDetail).not.toHaveBeenCalled();
    });

    it('replaces the persisted detail with the gh read and persists it', async () => {
      await seed(gitPullRequestDetailResource, PR, { value: detailResult });
      const fresh: DeviceGitPullRequestDetailResult = {
        ...detailResult,
        detail: { ...detailResult.detail!, title: 'Renamed on GitHub' },
      };
      vi.mocked(gitService.getPullRequestDetail).mockResolvedValue(fresh);

      const { result } = renderHook(() => useFetchGitPullRequestDetail('device-1', '/repo', 42), {
        wrapper,
      });

      await waitFor(() => expect(result.current.data?.detail?.title).toBe('Renamed on GitHub'));
      await waitFor(async () =>
        expect(await readRow(gitPullRequestDetailResource, PR)).toEqual({ value: fresh }),
      );
    });

    it('lets an empty linked-PR answer replace a stale persisted PR', async () => {
      await seed(gitLinkedPRResource, LINKED, {
        value: { pullRequest: { number: 42 }, pullRequestStatus: 'ok' },
      });
      const none = { pullRequest: null, pullRequestStatus: 'ok' } as const;
      vi.mocked(gitService.getLinkedPullRequest).mockResolvedValue(none as any);

      const { result } = renderHook(
        () => useFetchGitLinkedPR('device-1', '/repo', 'feat/x', true),
        { wrapper },
      );

      await waitFor(() => expect(result.current.data?.pullRequest).toBeNull());
      await waitFor(async () =>
        expect(await readRow(gitLinkedPRResource, LINKED)).toEqual({ value: none }),
      );
    });

    // Regression: an offline remote device resolves the lookup to `undefined`;
    // that was committed as "no PR", so the PR tab vanished and its persisted
    // copy was overwritten.
    it('keeps the persisted linked PR when the device read fails', async () => {
      const cached = { value: { pullRequest: { number: 42 }, pullRequestStatus: 'ok' } };
      await seed(gitLinkedPRResource, LINKED, cached);
      vi.mocked(gitService.getLinkedPullRequest).mockResolvedValue(undefined);

      const { result } = renderHook(
        () => useFetchGitLinkedPR('device-1', '/repo', 'feat/x', true),
        { wrapper },
      );

      await waitFor(() => expect(result.current.error).toBeTruthy());
      expect(result.current.data?.pullRequest?.number).toBe(42);
      expect(await readRow(gitLinkedPRResource, LINKED)).toEqual(cached);
    });

    // Regression: a transient `gh` failure answers `{ pullRequest: null,
    // status: 'error' }`; that was committed as "no PR" over the cached one.
    it('keeps the persisted linked PR when the lookup reports an error', async () => {
      const cached = { value: { pullRequest: { number: 42 }, pullRequestStatus: 'ok' } };
      await seed(gitLinkedPRResource, LINKED, cached);
      vi.mocked(gitService.getLinkedPullRequest).mockResolvedValue({
        pullRequest: null,
        pullRequestStatus: 'error',
      } as any);

      const { result } = renderHook(
        () => useFetchGitLinkedPR('device-1', '/repo', 'feat/x', true),
        { wrapper },
      );

      await waitFor(() => expect(result.current.error).toBeTruthy());
      expect(result.current.data?.pullRequest?.number).toBe(42);
      expect(result.current.isConfirmed).toBe(false);
      expect(await readRow(gitLinkedPRResource, LINKED)).toEqual(cached);
    });

    // A persisted row paints, but only the device's answer makes it actionable.
    it('reports a hydrated detail as unconfirmed until gh answers', async () => {
      await seed(gitPullRequestDetailResource, PR, { value: detailResult });
      let answer!: (value: DeviceGitPullRequestDetailResult) => void;
      vi.mocked(gitService.getPullRequestDetail).mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );

      const { result } = renderHook(() => useFetchGitPullRequestDetail('device-1', '/repo', 42), {
        wrapper,
      });

      await waitFor(() => expect(result.current.data?.detail?.title).toBe('Cached PR title'));
      expect(result.current.isConfirmed).toBe(false);

      await act(async () => answer(detailResult));
      await waitFor(() => expect(result.current.isConfirmed).toBe(true));
    });

    // Regression: the service maps a failed remote detail read to
    // `{ detail: null, status: 'error' }`, which replaced the persisted PR.
    it('keeps the persisted detail when the detail read fails', async () => {
      await seed(gitPullRequestDetailResource, PR, { value: detailResult });
      vi.mocked(gitService.getPullRequestDetail).mockResolvedValue({
        detail: null,
        status: 'error',
      });

      const { result } = renderHook(() => useFetchGitPullRequestDetail('device-1', '/repo', 42), {
        wrapper,
      });

      await waitFor(() => expect(result.current.error).toBeTruthy());
      expect(result.current.data?.detail?.title).toBe('Cached PR title');
      expect(await readRow(gitPullRequestDetailResource, PR)).toEqual({ value: detailResult });
    });

    // Regression: an unavailable remote device answers the merge context with
    // `null`; it was committed and persisted over the cached permission and
    // required-check context.
    it('keeps the persisted merge context when the device read fails', async () => {
      const cached = {
        value: {
          baseBehindBy: 0,
          requiredChecks: ['ci'],
          viewerCanBypass: false,
          viewerCanWrite: true,
        },
      };
      await seed(gitPullRequestMergeContextResource, MERGE, cached);
      vi.mocked(gitService.getPullRequestMergeContext).mockResolvedValue(null);

      const { result } = renderHook(
        () => useFetchGitPullRequestMergeContext('device-1', '/repo', detailResult.detail!),
        { wrapper },
      );

      await waitFor(() => expect(result.current.error).toBeTruthy());
      expect(result.current.data?.requiredChecks).toEqual(['ci']);
      expect(await readRow(gitPullRequestMergeContextResource, MERGE)).toEqual(cached);
    });

    it('does not read a PR for a non-GitHub repo', async () => {
      const { result } = renderHook(
        () => useFetchGitLinkedPR('device-1', '/repo', 'feat/x', false),
        { wrapper },
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(gitService.getLinkedPullRequest).not.toHaveBeenCalled();
      expect(result.current.isLoading).toBe(false);
    });

    // Regression: SWR settles a request still in flight when its key goes null
    // through the latest callbacks, which closed over null params, so a slow
    // `gh` lookup that failed after the read was disabled threw
    // "Cannot destructure property 'branch' of null" from `gitLinkedPRKey`.
    it('settles a lookup that fails after the read is disabled', async () => {
      let reject!: (error: unknown) => void;
      vi.mocked(gitService.getLinkedPullRequest).mockImplementation(
        () => new Promise((_resolve, rejectLookup) => (reject = rejectLookup)),
      );
      const linkedPR = useGitReviewStore.getState().slices.linkedPR;
      // Earlier never-resolving reads stay pending on the shared slice.
      const pendingBefore = linkedPR.debugPendingSyncRequests();
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);

      try {
        const { rerender } = renderHook(
          ({ isGithub }) => useFetchGitLinkedPR('device-1', '/repo', 'feat/x', isGithub),
          { initialProps: { isGithub: true }, wrapper },
        );
        await waitFor(() => expect(gitService.getLinkedPullRequest).toHaveBeenCalled());

        rerender({ isGithub: false });
        await act(async () => reject(new Error('gh pr list timed out')));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(unhandled).not.toHaveBeenCalled();
        expect(linkedPR.debugPendingSyncRequests()).toBe(pendingBefore);
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  describe('linked PR key', () => {
    it('shares the composer row when a topic has no recorded PR, and splits it when it has one', () => {
      const composer = { branch: 'feat/x', deviceId: 'device-1', path: '/repo' };

      expect(gitLinkedPRKey({ ...composer, pullRequestNumber: undefined })).toBe(
        gitLinkedPRKey(composer),
      );
      // A topic that recorded PR #7 asks `gh` about that PR, not "the PR of
      // this branch": its answer must not land on the composer's row.
      expect(gitLinkedPRKey({ ...composer, pullRequestNumber: 7 })).not.toBe(
        gitLinkedPRKey(composer),
      );
      expect(gitLinkedPRResource.syncKey!({ ...composer, pullRequestNumber: 7 })).toEqual([
        'device:gitLinkedPR',
        'device-1',
        '/repo',
        'feat/x',
        7,
      ]);
    });
  });
});
