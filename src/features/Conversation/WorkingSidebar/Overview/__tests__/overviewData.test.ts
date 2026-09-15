import { describe, expect, it } from 'vitest';

import { collectChangeStats, isLinkedWorktreeCheckout, shouldShowCiLabel } from '../overviewData';

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
