import type { WorkingDirEntry, WorkspaceInitResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  isWorkspaceCacheFresh,
  upsertWorkspaceScan,
  WORKSPACE_INIT_MAX_DIRS,
  WORKSPACE_INIT_TTL_MS,
} from '../workspaceInitCache';

const workspace: WorkspaceInitResult = {
  instructions: [{ content: '# Rules', source: 'AGENTS.md' }],
  skills: [
    { description: 'spa', name: 'spa-routes', path: '/proj/.agents/skills/spa-routes/SKILL.md' },
  ],
};

describe('isWorkspaceCacheFresh', () => {
  const now = 1_000_000_000_000;

  it('returns false for undefined / no workspace', () => {
    expect(isWorkspaceCacheFresh(undefined, now)).toBe(false);
    expect(isWorkspaceCacheFresh({ path: '/proj' }, now)).toBe(false);
  });

  it('returns false when scannedAt is missing even if workspace is present', () => {
    expect(isWorkspaceCacheFresh({ path: '/proj', workspace }, now)).toBe(false);
  });

  it('returns true within the TTL window', () => {
    const entry: WorkingDirEntry = {
      path: '/proj',
      workspace,
      workspaceScannedAt: now - (WORKSPACE_INIT_TTL_MS - 1),
    };
    expect(isWorkspaceCacheFresh(entry, now)).toBe(true);
  });

  it('returns false at / past the TTL boundary', () => {
    const atBoundary: WorkingDirEntry = {
      path: '/proj',
      workspace,
      workspaceScannedAt: now - WORKSPACE_INIT_TTL_MS,
    };
    const expired: WorkingDirEntry = {
      path: '/proj',
      workspace,
      workspaceScannedAt: now - (WORKSPACE_INIT_TTL_MS + 1),
    };
    expect(isWorkspaceCacheFresh(atBoundary, now)).toBe(false);
    expect(isWorkspaceCacheFresh(expired, now)).toBe(false);
  });
});

describe('upsertWorkspaceScan', () => {
  const scannedAt = 1_700_000_000_000;

  it('updates the matching entry in place, preserving repoType and order', () => {
    const dirs: WorkingDirEntry[] = [
      { path: '/a', repoType: 'git' },
      { path: '/proj', repoType: 'github' },
    ];

    const result = upsertWorkspaceScan(dirs, '/proj', workspace, scannedAt);

    expect(result).toEqual([
      { path: '/a', repoType: 'git' },
      { path: '/proj', repoType: 'github', workspace, workspaceScannedAt: scannedAt },
    ]);
  });

  it('updates a source entry with a worktree in place when upserted on its source path', () => {
    // Guards the worktree-scan fix: the caller resolves the MATCHED entry's
    // source path (not the bound worktree path), so a source entry keyed by
    // `/repo` with an active worktree is updated in place — no duplicate bare
    // worktree recent, and its git/worktree metadata survives.
    const dirs: WorkingDirEntry[] = [
      { git: { activeWorktree: '/repo-wt', isWorktree: true }, path: '/repo', repoType: 'git' },
    ];

    const result = upsertWorkspaceScan(dirs, '/repo', workspace, scannedAt);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      git: { activeWorktree: '/repo-wt', isWorktree: true },
      path: '/repo',
      repoType: 'git',
      workspace,
      workspaceScannedAt: scannedAt,
    });
  });

  it('prepends a new most-recent-first entry when the cwd is unrecorded', () => {
    const dirs: WorkingDirEntry[] = [{ path: '/a' }];

    const result = upsertWorkspaceScan(dirs, '/proj', workspace, scannedAt);

    expect(result[0]).toEqual({ path: '/proj', workspace, workspaceScannedAt: scannedAt });
    expect(result[1]).toEqual({ path: '/a' });
  });

  it('caps the list at WORKSPACE_INIT_MAX_DIRS when prepending', () => {
    const dirs: WorkingDirEntry[] = Array.from({ length: WORKSPACE_INIT_MAX_DIRS }, (_, i) => ({
      path: `/dir-${i}`,
    }));

    const result = upsertWorkspaceScan(dirs, '/proj', workspace, scannedAt);

    expect(result).toHaveLength(WORKSPACE_INIT_MAX_DIRS);
    expect(result[0].path).toBe('/proj');
    // The oldest (last) entry is dropped.
    expect(result.some((d) => d.path === `/dir-${WORKSPACE_INIT_MAX_DIRS - 1}`)).toBe(false);
  });

  it('does not mutate the input array', () => {
    const dirs: WorkingDirEntry[] = [{ path: '/proj' }];
    const snapshot = structuredClone(dirs);

    upsertWorkspaceScan(dirs, '/proj', workspace, scannedAt);

    expect(dirs).toEqual(snapshot);
  });
});
