import { describe, expect, it } from 'vitest';

import { getMissingWorkingDirectory, resolveStaleWorktreeReset } from './staleWorktreeReset';

describe('resolveStaleWorktreeReset', () => {
  it('offers the source repo when the topic still records a deleted worktree', () => {
    expect(
      resolveStaleWorktreeReset(
        {
          git: { activeWorktree: '/tmp/ibench-push', branch: 'tj/fix', isWorktree: true },
          path: '/Users/me/ibench/landing',
        },
        '/tmp/ibench-push',
      ),
    ).toEqual({ entry: { path: '/Users/me/ibench/landing' }, name: 'landing' });
  });

  it('keeps the recorded repo type', () => {
    expect(
      resolveStaleWorktreeReset({
        git: { activeWorktree: '/tmp/wt' },
        path: '/repo',
        repoType: 'github',
      })?.entry,
    ).toEqual({ path: '/repo', repoType: 'github' });
  });

  it('offers nothing without a worktree override', () => {
    expect(resolveStaleWorktreeReset({ path: '/repo' })).toBeUndefined();
    expect(resolveStaleWorktreeReset(undefined)).toBeUndefined();
    expect(
      resolveStaleWorktreeReset({ git: { activeWorktree: '/repo' }, path: '/repo' }),
    ).toBeUndefined();
  });

  it('offers nothing when the source repo itself is the missing directory', () => {
    expect(
      resolveStaleWorktreeReset({ git: { activeWorktree: '/tmp/wt' }, path: '/repo' }, '/repo'),
    ).toBeUndefined();
  });

  it('offers nothing when the error names an older worktree the topic has left', () => {
    expect(
      resolveStaleWorktreeReset(
        { git: { activeWorktree: '/tmp/wt-b' }, path: '/repo' },
        '/tmp/wt-a',
      ),
    ).toBeUndefined();
  });
});

describe('getMissingWorkingDirectory', () => {
  it('prefers the structured field', () => {
    expect(getMissingWorkingDirectory({ message: 'anything', workingDirectory: '/tmp/wt' })).toBe(
      '/tmp/wt',
    );
  });

  it('reads the path from the spawn guard message', () => {
    expect(
      getMissingWorkingDirectory({ message: 'Working directory does not exist: /tmp/wt' }),
    ).toBe('/tmp/wt');
    expect(
      getMissingWorkingDirectory({ message: 'Working directory is not a directory: /tmp/f' }),
    ).toBe('/tmp/f');
  });

  it('returns undefined when no path is known', () => {
    expect(getMissingWorkingDirectory({ message: 'spawn failed' })).toBeUndefined();
    expect(getMissingWorkingDirectory(undefined)).toBeUndefined();
    expect(getMissingWorkingDirectory(null)).toBeUndefined();
  });
});
