import type { DeviceGitPullRequestDetailResult } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gitService } from '@/services/git';

import {
  pullRequestDetailRefreshInterval,
  useFetchGitPullRequestActivity,
  useFetchGitPullRequestDetail,
  useFetchGitPullRequestMergeContext,
} from './gitHooks';

const detailResult = (
  overrides: Partial<DeviceGitPullRequestDetailResult['detail']> = {},
): DeviceGitPullRequestDetailResult => ({
  detail: {
    additions: 0,
    author: 'octocat',
    baseBehindBy: 0,
    baseRefName: 'main',
    body: '',
    changedFiles: 0,
    checks: [],
    comments: [],
    commits: [],
    deletions: 0,
    headRefName: 'feature',
    headRefOid: 'a'.repeat(40),
    isCrossRepository: false,
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    number: 1,
    repo: { name: 'repo', owner: 'octocat' },
    reviewDecision: null,
    reviews: [],
    state: 'open',
    title: 'title',
    url: 'https://github.com/octocat/repo/pull/1',
    viewerCanBypass: false,
    viewerCanWrite: true,
    ...overrides,
  },
  status: 'ok',
});

describe('pullRequestDetailRefreshInterval', () => {
  it.each([
    { reviewDecision: 'REVIEW_REQUIRED' as const },
    { reviewDecision: 'CHANGES_REQUESTED' as const },
    { mergeStateStatus: 'BLOCKED' as const },
    { autoMerge: { method: 'squash' as const } },
  ])('keeps polling after checks finish while awaiting %o', (overrides) => {
    const result = detailResult({
      ...overrides,
      checks: [{ name: 'ci', required: true, status: 'success' }],
    });
    expect(pullRequestDetailRefreshInterval(result, true)).toBe(30_000);
    expect(pullRequestDetailRefreshInterval(result, false)).toBe(0);
    for (const state of ['closed', 'merged'] as const) {
      expect(pullRequestDetailRefreshInterval(detailResult({ ...overrides, state }), true)).toBe(0);
    }
  });
  it('returns 0 when not active', () => {
    expect(pullRequestDetailRefreshInterval(detailResult(), false)).toBe(0);
  });

  it('returns 0 when there is no detail', () => {
    expect(pullRequestDetailRefreshInterval({ detail: null, status: 'ok' }, true)).toBe(0);
  });

  it('returns 0 when settled and no pending checks', () => {
    expect(pullRequestDetailRefreshInterval(detailResult(), true)).toBe(0);
  });

  it('polls while mergeable is UNKNOWN', () => {
    expect(pullRequestDetailRefreshInterval(detailResult({ mergeable: 'UNKNOWN' }), true)).toBe(
      30_000,
    );
  });

  it('polls while a check is pending', () => {
    const result = detailResult({
      checks: [{ name: 'ci', required: true, status: 'pending' }],
    });
    expect(pullRequestDetailRefreshInterval(result, true)).toBe(30_000);
  });
});

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'test-workspace',
}));
afterEach(() => vi.restoreAllMocks());

describe('PR bootstrap hooks', () => {
  const setup = () => {
    const cache = new Map();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(SWRConfig, { value: { provider: () => cache } }, children);
    const useBootstrap = () => {
      const core = useFetchGitPullRequestDetail('device', '/repo', 42);
      const activity = useFetchGitPullRequestActivity(
        'device',
        '/repo',
        core.data?.detail?.number,
        false,
      );
      return { core: { ...core }, activity: { ...activity } };
    };
    return { wrapper, useBootstrap };
  };

  it('exposes core before activity, retries activity independently, and dedupes remounts', async () => {
    const detail = detailResult({ number: 42 });
    let resolveCore!: (data: DeviceGitPullRequestDetailResult) => void;
    const coreRead = vi.spyOn(gitService, 'getPullRequestDetail').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCore = resolve;
        }),
    );
    const activityRead = vi
      .spyOn(gitService, 'getPullRequestActivity')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ comments: [], commits: [], reviews: [] });
    const { wrapper, useBootstrap } = setup();
    const first = renderHook(useBootstrap, { wrapper });
    await waitFor(() => expect(coreRead).toHaveBeenCalledTimes(1));
    expect(activityRead).not.toHaveBeenCalled();
    await act(async () => resolveCore(detail));
    await waitFor(() => expect(first.result.current.activity.error).toBeDefined());
    expect(first.result.current.core.data?.detail?.title).toBe('title');
    await act(async () => {
      await first.result.current.activity.mutate();
    });
    expect(first.result.current.activity.data?.comments).toEqual([]);
    first.unmount();
    const second = renderHook(useBootstrap, { wrapper });
    expect(second.result.current.core.data?.detail?.title).toBe('title');
    expect(coreRead).toHaveBeenCalledTimes(1);
    expect(activityRead).toHaveBeenCalledTimes(2);
  });

  it('loads new merge context when base changes without a head change', async () => {
    const read = vi.spyOn(gitService, 'getPullRequestMergeContext').mockResolvedValue({
      baseBehindBy: 0,
      requiredChecks: [],
      viewerCanBypass: false,
      viewerCanWrite: true,
    });
    const { wrapper } = setup();
    const { rerender } = renderHook(
      ({ base }) =>
        useFetchGitPullRequestMergeContext('device', '/repo', {
          baseRefName: base,
          headRefOid: 'a'.repeat(40),
          number: 42,
          repo: { owner: 'test', name: 'repo' },
        }),
      { wrapper, initialProps: { base: 'main' } },
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    rerender({ base: 'canary' });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });
});
