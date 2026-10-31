import { describe, expect, it } from 'vitest';

import { buildCodexWorktreeWritableArgs } from './codexWorktreeArgs';

const ROOTS_ARG = '--agent-arg=sandbox_workspace_write.writable_roots=';

describe('buildCodexWorktreeWritableArgs', () => {
  it('adds the worktree as a writable root', () => {
    expect(
      buildCodexWorktreeWritableArgs({ sourceDirectory: '/repo', worktreePath: '/repo-wt' }),
    ).toEqual(['--agent-arg=-c', `${ROOTS_ARG}["/repo-wt"]`]);
  });

  it('adds nothing without a worktree, or when the worktree is the repo itself', () => {
    expect(buildCodexWorktreeWritableArgs({ sourceDirectory: '/repo' })).toEqual([]);
    expect(
      buildCodexWorktreeWritableArgs({ sourceDirectory: '/repo', worktreePath: '/repo' }),
    ).toEqual([]);
  });

  it('keeps the writable roots the provider already sets', () => {
    expect(
      buildCodexWorktreeWritableArgs({
        providerArgs: [
          '--full-auto',
          '-c',
          `sandbox_workspace_write.writable_roots=["/cache", 'C:\\data']`,
        ],
        sourceDirectory: '/repo',
        worktreePath: '/repo-wt',
      }),
    ).toEqual(['--agent-arg=-c', `${ROOTS_ARG}["/cache","C:\\\\data","/repo-wt"]`]);
  });

  it('adds nothing when the provider already lists the worktree', () => {
    expect(
      buildCodexWorktreeWritableArgs({
        providerArgs: ['--config=sandbox_workspace_write.writable_roots=["/repo-wt"]'],
        sourceDirectory: '/repo',
        worktreePath: '/repo-wt',
      }),
    ).toEqual([]);
  });

  it('escapes a Windows worktree path for TOML', () => {
    expect(
      buildCodexWorktreeWritableArgs({
        sourceDirectory: 'C:\\code\\repo',
        worktreePath: 'C:\\code\\repo-wt',
      }),
    ).toEqual(['--agent-arg=-c', `${ROOTS_ARG}["C:\\\\code\\\\repo-wt"]`]);
  });
});
