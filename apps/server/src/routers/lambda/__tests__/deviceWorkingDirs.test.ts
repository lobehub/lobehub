import type { WorkingDirEntry, WorkspaceInitResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { preserveWorkspaceCache, setWorkingDirRepoType } from '../deviceWorkingDirs';

const workspace: WorkspaceInitResult = {
  instructions: [{ content: '# Rules', source: 'AGENTS.md' }],
  skills: [
    { description: 'spa', name: 'spa-routes', path: '/proj/.agents/skills/spa-routes/SKILL.md' },
  ],
};

describe('preserveWorkspaceCache', () => {
  it('re-attaches workspace + workspaceScannedAt by path onto stripped entries', () => {
    const incoming: WorkingDirEntry[] = [{ path: '/proj', repoType: 'git' }, { path: '/other' }];
    const stored: WorkingDirEntry[] = [
      { path: '/proj', repoType: 'git', workspace, workspaceScannedAt: 123 },
      { path: '/other' },
    ];

    expect(preserveWorkspaceCache(incoming, stored)).toEqual([
      { path: '/proj', repoType: 'git', workspace, workspaceScannedAt: 123 },
      { path: '/other' },
    ]);
  });

  it('preserves incoming git metadata while re-attaching the server cache', () => {
    const incoming: WorkingDirEntry[] = [
      {
        git: { activeWorktree: '/proj-fix', branch: 'fix', isWorktree: true },
        path: '/proj',
        repoType: 'git',
      },
    ];
    const stored: WorkingDirEntry[] = [{ path: '/proj', workspace, workspaceScannedAt: 123 }];

    expect(preserveWorkspaceCache(incoming, stored)).toEqual([
      {
        git: { activeWorktree: '/proj-fix', branch: 'fix', isWorktree: true },
        path: '/proj',
        repoType: 'git',
        workspace,
        workspaceScannedAt: 123,
      },
    ]);
  });

  it('drops the cache for a path no longer present (dir removed)', () => {
    const stored: WorkingDirEntry[] = [{ path: '/proj', workspace, workspaceScannedAt: 123 }];

    const result = preserveWorkspaceCache([{ path: '/other' }], stored);

    expect(result).toEqual([{ path: '/other' }]);
  });

  it('leaves brand-new paths without a cache', () => {
    const result = preserveWorkspaceCache([{ path: '/fresh' }], []);
    expect(result).toEqual([{ path: '/fresh' }]);
  });

  it('returns the incoming list unchanged when nothing is cached', () => {
    const incoming: WorkingDirEntry[] = [{ path: '/a' }, { path: '/b', repoType: 'github' }];
    expect(preserveWorkspaceCache(incoming, [{ path: '/a' }])).toEqual(incoming);
  });

  it('does not mutate the inputs', () => {
    const incoming: WorkingDirEntry[] = [{ path: '/proj' }];
    const stored: WorkingDirEntry[] = [{ path: '/proj', workspace, workspaceScannedAt: 1 }];
    const incomingSnapshot = structuredClone(incoming);

    preserveWorkspaceCache(incoming, stored);

    expect(incoming).toEqual(incomingSnapshot);
  });
});

describe('setWorkingDirRepoType', () => {
  it('patches the matching entry in place, keeping order and the server cache', () => {
    const current: WorkingDirEntry[] = [
      { path: '/other', repoType: 'git' },
      { path: '/proj', workspace, workspaceScannedAt: 123 },
    ];

    expect(setWorkingDirRepoType(current, '/proj', 'github')).toEqual([
      { path: '/other', repoType: 'git' },
      { path: '/proj', repoType: 'github', workspace, workspaceScannedAt: 123 },
    ]);
  });

  it('matches an entry by its active worktree path', () => {
    const current: WorkingDirEntry[] = [{ git: { activeWorktree: '/proj-fix' }, path: '/proj' }];

    expect(setWorkingDirRepoType(current, '/proj-fix', 'git')).toEqual([
      { git: { activeWorktree: '/proj-fix' }, path: '/proj', repoType: 'git' },
    ]);
  });

  it('clears the repo type when the dir is no longer a repo', () => {
    expect(
      setWorkingDirRepoType([{ path: '/proj', repoType: 'github' }], '/proj', undefined),
    ).toEqual([{ path: '/proj' }]);
  });

  it('returns undefined when nothing changes', () => {
    const current: WorkingDirEntry[] = [{ path: '/proj', repoType: 'github' }];

    expect(setWorkingDirRepoType(current, '/proj', 'github')).toBeUndefined();
    expect(setWorkingDirRepoType(current, '/missing', 'git')).toBeUndefined();
  });
});
