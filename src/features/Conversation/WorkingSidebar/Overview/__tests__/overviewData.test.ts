import { describe, expect, it } from 'vitest';

import {
  collectChangeStats,
  getStatusDeviceId,
  isLinkedWorktreeCheckout,
  shouldShowCiLabel,
  shouldShowGitSkeleton,
} from '../overviewData';

describe('collectChangeStats', () => {
  it('sums additions/deletions across repo and submodule patches', () => {
    expect(
      collectChangeStats({
        patches: [
          { additions: 200, deletions: 10, path: 'a.ts' },
          { additions: 10, deletions: 1, path: 'b.ts' },
        ],
        submodules: [{ patches: [{ additions: 5, deletions: 2, path: 'sub/c.ts' }] }],
      } as never),
    ).toEqual({ additions: 215, deletions: 13, files: 3 });
  });

  it('returns zeros for an undefined or empty working tree', () => {
    expect(collectChangeStats(undefined)).toEqual({ additions: 0, deletions: 0, files: 0 });
    expect(collectChangeStats({ patches: [] } as never)).toEqual({
      additions: 0,
      deletions: 0,
      files: 0,
    });
  });
});

describe('isLinkedWorktreeCheckout', () => {
  const main = { current: false, path: '/repo' } as never;
  const linked = { current: true, path: '/repo-wt' } as never;

  it('is false when the checkout IS the main worktree', () => {
    expect(isLinkedWorktreeCheckout('/repo', [main, linked])).toBe(false);
  });

  it('is true when the checkout differs from the main worktree', () => {
    expect(isLinkedWorktreeCheckout('/repo-wt', [main, linked])).toBe(true);
  });

  it('is true for every checkout of a bare repo', () => {
    expect(
      isLinkedWorktreeCheckout('/repo', [
        { bare: true, current: false, path: '/repo.git' },
      ] as never[]),
    ).toBe(true);
  });

  it('is false when the only difference is the macOS /private/tmp alias', () => {
    expect(
      isLinkedWorktreeCheckout('/tmp/scratch', [
        { current: true, path: '/private/tmp/scratch' },
      ] as never[]),
    ).toBe(false);
  });

  it('is false without a directory or without worktree data', () => {
    expect(isLinkedWorktreeCheckout(undefined, [main])).toBe(false);
    expect(isLinkedWorktreeCheckout('/repo-wt', [])).toBe(false);
  });
});

describe('shouldShowCiLabel', () => {
  it('labels only failing or running rollups — passing stays icon-only', () => {
    expect(shouldShowCiLabel('failure')).toBe(true);
    expect(shouldShowCiLabel('pending')).toBe(true);
    expect(shouldShowCiLabel('success')).toBe(false);
    expect(shouldShowCiLabel('unknown')).toBe(false);
    expect(shouldShowCiLabel(undefined)).toBe(false);
  });
});

describe('getStatusDeviceId', () => {
  it('shows the bound remote device', () => {
    expect(getStatusDeviceId('device', 'dev-1')).toBe('dev-1');
  });

  it('shows the bound local desktop, which has no RPC routing id', () => {
    expect(getStatusDeviceId('local', 'desktop-1')).toBe('desktop-1');
  });

  it.each(['auto', 'none', 'sandbox'] as const)('shows nothing for %s', (target) => {
    expect(getStatusDeviceId(target, 'dev-1')).toBeUndefined();
  });

  it('shows nothing when no device is bound', () => {
    expect(getStatusDeviceId('device', undefined)).toBeUndefined();
  });
});

describe('shouldShowGitSkeleton', () => {
  it('shows the skeleton only on a first-ever load with no git data at all', () => {
    expect(shouldShowGitSkeleton({ hasData: false, loading: true })).toBe(true);
  });

  // Regression: the skeleton keyed off `branchLoading || reviewLoading`, so a
  // reload with a cached branch still blanked the whole section until the diff
  // patches came back.
  it('keeps rendering cached rows while other git reads are still in flight', () => {
    expect(shouldShowGitSkeleton({ hasData: true, loading: true })).toBe(false);
  });

  it('never shows the skeleton once loading settles', () => {
    expect(shouldShowGitSkeleton({ hasData: false, loading: false })).toBe(false);
  });
});
