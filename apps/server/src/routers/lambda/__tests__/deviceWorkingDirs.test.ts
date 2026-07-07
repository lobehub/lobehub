import type { WorkingDirEntry, WorkspaceInitResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { preserveWorkspaceCache } from '../deviceWorkingDirs';

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
