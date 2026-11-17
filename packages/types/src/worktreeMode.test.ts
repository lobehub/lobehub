import { describe, expect, it } from 'vitest';

import {
  applyWorktreeModeDir,
  getWorktreeModeKey,
  normalizeDirectoryPath,
  WORKTREE_MODE_DIRS_LIMIT,
} from './worktreeMode';

describe('normalizeDirectoryPath', () => {
  it('drops surrounding space and trailing separators', () => {
    expect(normalizeDirectoryPath(' /code/lobehub/ ')).toBe('/code/lobehub');
    expect(normalizeDirectoryPath('C:\\code\\lobehub\\\\')).toBe('C:\\code\\lobehub');
  });

  it('keeps a bare root', () => {
    expect(normalizeDirectoryPath('/')).toBe('/');
  });
});

describe('getWorktreeModeKey', () => {
  it('keys the same directory identically however it is spelled', () => {
    expect(getWorktreeModeKey('dev-1', '/code/lobehub/')).toBe(
      getWorktreeModeKey('dev-1', '/code/lobehub'),
    );
  });

  it('keeps devices and directories apart', () => {
    expect(getWorktreeModeKey('dev-1', '/code/a')).not.toBe(getWorktreeModeKey('dev-2', '/code/a'));
    expect(getWorktreeModeKey('dev-1', '/code/a')).not.toBe(getWorktreeModeKey('dev-1', '/code/b'));
  });
});

describe('applyWorktreeModeDir', () => {
  it('moves a key set on to the front without duplicating it', () => {
    expect(applyWorktreeModeDir(['a', 'b'], 'b', true)).toEqual(['b', 'a']);
    expect(applyWorktreeModeDir(undefined, 'a', true)).toEqual(['a']);
  });

  it('drops a key set off', () => {
    expect(applyWorktreeModeDir(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(applyWorktreeModeDir([], 'a', false)).toEqual([]);
  });

  it('evicts the least recently set directory past the cap', () => {
    const full = Array.from({ length: WORKTREE_MODE_DIRS_LIMIT }, (_, i) => `k${i}`);
    const next = applyWorktreeModeDir(full, 'new', true);
    expect(next).toHaveLength(WORKTREE_MODE_DIRS_LIMIT);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`k${WORKTREE_MODE_DIRS_LIMIT - 1}`);
  });
});
