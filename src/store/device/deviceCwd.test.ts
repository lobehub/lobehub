import type { WorkingDirEntry } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { nextWorkingDirs, WORKING_DIRS_MAX } from './deviceCwd';

const entry = (path: string, repoType?: 'git' | 'github'): WorkingDirEntry => ({ path, repoType });

describe('nextWorkingDirs', () => {
  it('prepends a new entry as most-recent', () => {
    expect(nextWorkingDirs(entry('/b'), [entry('/a')])).toEqual([entry('/b'), entry('/a')]);
  });

  it('moves an existing path to the front without duplicating it', () => {
    expect(nextWorkingDirs(entry('/a'), [entry('/a'), entry('/b'), entry('/c')])).toEqual([
      entry('/a'),
      entry('/b'),
      entry('/c'),
    ]);
    expect(nextWorkingDirs(entry('/c'), [entry('/a'), entry('/b'), entry('/c')])).toEqual([
      entry('/c'),
      entry('/a'),
      entry('/b'),
    ]);
  });

  it('preserves and updates metadata such as repoType', () => {
    expect(nextWorkingDirs(entry('/a', 'github'), [])).toEqual([entry('/a', 'github')]);
    // Re-picking with a freshly-detected type overwrites the stale entry.
    expect(nextWorkingDirs(entry('/a', 'github'), [entry('/a', 'git')])).toEqual([
      entry('/a', 'github'),
    ]);
  });

  it('stores active worktree metadata on the source entry without duplicating the source', () => {
    const result = nextWorkingDirs(
      { git: { activeWorktree: '/repo-fix' }, path: '/repo', repoType: 'git' },
      [entry('/repo', 'git'), entry('/other')],
    );

    expect(result).toEqual([
      { git: { activeWorktree: '/repo-fix' }, path: '/repo', repoType: 'git' },
      entry('/other'),
    ]);
  });

  it('preserves existing workspace cache when updating a source entry', () => {
    const workspace = { instructions: [], skills: [] };
    const result = nextWorkingDirs(
      { git: { activeWorktree: '/repo-fix' }, path: '/repo', repoType: 'git' },
      [{ path: '/repo', repoType: 'git', workspace, workspaceScannedAt: 123 }],
    );

    expect(result).toEqual([
      {
        git: { activeWorktree: '/repo-fix' },
        path: '/repo',
        repoType: 'git',
        workspace,
        workspaceScannedAt: 123,
      },
    ]);
  });

  it('caps the list length', () => {
    const current = Array.from({ length: WORKING_DIRS_MAX }, (_, i) => entry(`/p${i}`));
    const result = nextWorkingDirs(entry('/new'), current);
    expect(result).toHaveLength(WORKING_DIRS_MAX);
    expect(result[0]).toEqual(entry('/new'));
    expect(result.some((d) => d.path === `/p${WORKING_DIRS_MAX - 1}`)).toBe(false); // oldest dropped
  });

  it('trims the path and ignores a blank one', () => {
    expect(nextWorkingDirs(entry('  /a  '), [entry('/b')])).toEqual([entry('/a'), entry('/b')]);
    expect(nextWorkingDirs(entry('   '), [entry('/b')])).toEqual([entry('/b')]);
    expect(nextWorkingDirs(entry(''), [entry('/b')])).toEqual([entry('/b')]);
  });

  it('defaults to an empty current list', () => {
    expect(nextWorkingDirs(entry('/a'))).toEqual([entry('/a')]);
  });
});
