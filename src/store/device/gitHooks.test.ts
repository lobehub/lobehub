import type { DeviceGitPullRequestDetailResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { pullRequestDetailRefreshInterval } from './gitHooks';

const detailResult = (
  overrides: Partial<DeviceGitPullRequestDetailResult['detail']> = {},
): DeviceGitPullRequestDetailResult => ({
  detail: {
    additions: 0,
    author: 'octocat',
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
