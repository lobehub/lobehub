import { describe, expect, it } from 'vitest';

import { applyOwnBranchToConfig, parseCreatedBranch } from './ownBranch';

describe('parseCreatedBranch', () => {
  it.each([
    ["Switched to a new branch 'feat/x'", 'feat/x'],
    ["Preparing worktree (new branch 'lobehub/feat-y')\nHEAD is now at abc", 'lobehub/feat-y'],
    [
      'Created worktree at /tmp/wt on branch worktree-v1.2. The session is now working in the worktree',
      'worktree-v1.2',
    ],
  ])('reads a created branch from %s', (content, branch) => {
    expect(parseCreatedBranch(content)).toBe(branch);
  });

  it('ignores a switch to an existing branch', () => {
    expect(parseCreatedBranch("Switched to branch 'main'")).toBeUndefined();
    expect(parseCreatedBranch("Preparing worktree (checking out 'main')")).toBeUndefined();
    expect(
      parseCreatedBranch('Entered worktree at /tmp/wt on branch main. The session'),
    ).toBeUndefined();
    expect(parseCreatedBranch(undefined)).toBeUndefined();
  });
});

describe('applyOwnBranchToConfig', () => {
  const config = { git: { branch: 'feat/x' }, path: '/repo' };

  it('records the created branch only while the topic is on it', () => {
    expect(applyOwnBranchToConfig(config, 'feat/x')?.git?.ownBranch).toBe('feat/x');
    expect(applyOwnBranchToConfig(config, 'feat/other')).toBe(config);
    expect(applyOwnBranchToConfig(config, undefined)).toBe(config);
  });
});
