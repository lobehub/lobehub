import { describe, expect, it } from 'vitest';

import {
  claimAutoCreatedWorktree,
  findOwnedWorktree,
  isRetiredTopicStatus,
  resolveOwnedWorktrees,
} from './ownedWorktree';

const NOW = () => '2026-11-17T00:00:00.000Z';
const WT = '/Users/me/.lobehub/worktrees/repo-1a2b3c4d/quiet-hill';

describe('claimAutoCreatedWorktree', () => {
  it('records the worktree the app created, with its branch and device', () => {
    const claimed = claimAutoCreatedWorktree(
      {
        boundDeviceId: 'dev-1',
        workingDirectoryConfig: {
          git: {
            activeWorktree: WT,
            autoCreated: true,
            autoCreatedAt: '2026-11-16T00:00:00.000Z',
            branch: 'lobehub/quiet-hill',
          },
          path: '/code/repo',
          sessionPath: WT,
        },
      },
      NOW,
    );

    expect(claimed.ownedWorktrees).toEqual([
      {
        branch: 'lobehub/quiet-hill',
        createdAt: '2026-11-16T00:00:00.000Z',
        deviceId: 'dev-1',
        path: WT,
        sourcePath: '/code/repo',
      },
    ]);
  });

  it('is idempotent and keeps a recorded cleanup state', () => {
    const metadata = {
      ownedWorktrees: [
        {
          cleanup: { at: 'x', state: 'kept' as const },
          createdAt: 'y',
          deviceId: 'dev-1',
          path: WT,
          sourcePath: '/code/repo',
        },
      ],
      workingDirectoryConfig: {
        git: { activeWorktree: WT, autoCreated: true },
        path: '/code/repo',
      },
    };
    expect(claimAutoCreatedWorktree(metadata, NOW)).toBe(metadata);
  });

  it('carries the creation receipt into the claim', () => {
    const claimed = claimAutoCreatedWorktree(
      {
        workingDirectoryConfig: {
          git: { activeWorktree: WT, autoCreated: true, ownerToken: 'receipt-0123456789abcdef' },
          path: '/code/repo',
        },
      },
      NOW,
    );
    expect(claimed.ownedWorktrees?.[0].ownerToken).toBe('receipt-0123456789abcdef');
  });

  it('fills a device id that arrives later', () => {
    const claimed = claimAutoCreatedWorktree(
      {
        boundDeviceId: 'dev-2',
        ownedWorktrees: [{ createdAt: 'y', path: WT, sourcePath: '/code/repo' }],
        workingDirectoryConfig: {
          git: { activeWorktree: WT, autoCreated: true },
          path: '/code/repo',
        },
      },
      NOW,
    );
    expect(claimed.ownedWorktrees?.[0].deviceId).toBe('dev-2');
  });

  it('claims nothing for a worktree the user picked', () => {
    const metadata = {
      workingDirectoryConfig: { git: { activeWorktree: WT }, path: '/code/repo' },
    };
    expect(claimAutoCreatedWorktree(metadata, NOW)).toBe(metadata);
  });

  it('keeps an earlier claim after the topic moved to another worktree', () => {
    const first = claimAutoCreatedWorktree(
      {
        workingDirectoryConfig: {
          git: { activeWorktree: WT, autoCreated: true },
          path: '/code/repo',
        },
      },
      NOW,
    );
    // The marker is dropped on a move (`dropStaleAutoCreated`); the claim stays.
    const moved = claimAutoCreatedWorktree(
      {
        ...first,
        workingDirectoryConfig: { git: { activeWorktree: '/other' }, path: '/code/repo' },
      },
      NOW,
    );
    expect(moved.ownedWorktrees?.map((entry) => entry.path)).toEqual([WT]);
  });
});

describe('resolveOwnedWorktrees (backfill for existing topics)', () => {
  it('backfills from autoCreated + activeWorktree', () => {
    expect(
      resolveOwnedWorktrees(
        {
          boundDeviceId: 'dev-1',
          workingDirectoryConfig: {
            git: { activeWorktree: WT, autoCreated: true, branch: 'lobehub/quiet-hill' },
            path: '/code/repo',
          },
        },
        NOW,
      ),
    ).toEqual([
      {
        branch: 'lobehub/quiet-hill',
        createdAt: NOW(),
        deviceId: 'dev-1',
        path: WT,
        sourcePath: '/code/repo',
      },
    ]);
  });

  it('backfills from sessionPath after the marker was dropped, without a branch', () => {
    expect(
      resolveOwnedWorktrees(
        {
          workingDirectoryConfig: {
            git: { activeWorktree: '/elsewhere', branch: 'feat/x' },
            path: '/code/repo',
            sessionPath: WT,
          },
        },
        NOW,
      ),
    ).toEqual([{ createdAt: NOW(), path: WT, sourcePath: '/code/repo' }]);
  });

  it('ignores a sessionPath that is the source itself, and topics without one', () => {
    expect(
      resolveOwnedWorktrees({
        workingDirectoryConfig: { path: '/code/repo', sessionPath: '/code/repo/' },
      }),
    ).toEqual([]);
    expect(resolveOwnedWorktrees({ workingDirectoryConfig: { path: '/code/repo' } })).toEqual([]);
    expect(resolveOwnedWorktrees(undefined)).toEqual([]);
  });

  it('does not duplicate a claimed path', () => {
    const owned = resolveOwnedWorktrees({
      ownedWorktrees: [{ createdAt: 'y', path: WT, sourcePath: '/code/repo' }],
      workingDirectoryConfig: { path: '/code/repo', sessionPath: `${WT}/` },
    });
    expect(owned).toHaveLength(1);
    expect(findOwnedWorktree({ ownedWorktrees: owned }, WT)?.sourcePath).toBe('/code/repo');
  });
});

describe('isRetiredTopicStatus', () => {
  it('treats the UI archive (completed) and legacy archived as retired', () => {
    expect(isRetiredTopicStatus('completed')).toBe(true);
    expect(isRetiredTopicStatus('archived')).toBe(true);
    expect(isRetiredTopicStatus('active')).toBe(false);
    expect(isRetiredTopicStatus(null)).toBe(false);
  });
});
