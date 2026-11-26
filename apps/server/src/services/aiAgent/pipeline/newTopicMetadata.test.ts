// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { buildNewTopicMetadata, resolveTopicOpenedBy } from './newTopicMetadata';

const worktree = '/Users/me/.lobehub/worktrees/lobehub-0000beef/quiet-hill';
const prepared = {
  git: {
    activeWorktree: worktree,
    autoCreated: true,
    autoCreatedAt: '2026-11-17T00:00:00.000Z',
    branch: 'lobehub/quiet-hill',
    isWorktree: true,
  },
  path: '/code/lobehub/',
};

describe('buildNewTopicMetadata — project directory', () => {
  it('pins a plain project topic to the project directory', () => {
    const metadata = buildNewTopicMetadata({
      appContext: { initialTopicMetadata: { workingDirectory: '/elsewhere' } } as any,
      projectDirectory: { path: '/code/lobehub' },
    });

    expect(metadata).toMatchObject({
      workingDirectory: '/code/lobehub',
      workingDirectoryConfig: { path: '/code/lobehub' },
    });
  });

  // The composer cut a worktree from the project directory on the first send:
  // the topic runs there, with the project directory as its source.
  it('keeps a worktree prepared from the same project directory', () => {
    const metadata = buildNewTopicMetadata({
      appContext: {
        initialTopicMetadata: { workingDirectory: worktree, workingDirectoryConfig: prepared },
      } as any,
      projectDirectory: { path: '/code/lobehub' },
    });

    expect(metadata).toMatchObject({
      workingDirectory: worktree,
      workingDirectoryConfig: { ...prepared, path: '/code/lobehub' },
    });
  });

  it('ignores a worktree prepared from another directory', () => {
    const metadata = buildNewTopicMetadata({
      appContext: {
        initialTopicMetadata: {
          workingDirectory: worktree,
          workingDirectoryConfig: { ...prepared, path: '/code/other' },
        },
      } as any,
      projectDirectory: { path: '/code/lobehub' },
    });

    expect(metadata).toMatchObject({
      workingDirectory: '/code/lobehub',
      workingDirectoryConfig: { path: '/code/lobehub' },
    });
  });

  it('ignores a picked worktree that the app did not create', () => {
    const metadata = buildNewTopicMetadata({
      appContext: {
        initialTopicMetadata: {
          workingDirectoryConfig: { git: { activeWorktree: worktree }, path: '/code/lobehub' },
        },
      } as any,
      projectDirectory: { path: '/code/lobehub' },
    });

    expect(metadata?.workingDirectoryConfig).toEqual({ path: '/code/lobehub' });
  });
});

describe('buildNewTopicMetadata — Claude Code permission mode', () => {
  it('is born with the mode the composer chip showed', () => {
    expect(
      buildNewTopicMetadata({
        appContext: {
          initialTopicMetadata: { heteroPermissionMode: 'plan', workingDirectory: '/code/d' },
        } as any,
      }),
    ).toMatchObject({ heteroPermissionMode: 'plan', workingDirectory: '/code/d' });
  });

  it('keeps the mode inside a project directory too', () => {
    expect(
      buildNewTopicMetadata({
        appContext: { initialTopicMetadata: { heteroPermissionMode: 'default' } } as any,
        projectDirectory: { path: '/code/lobehub' },
      }),
    ).toMatchObject({ heteroPermissionMode: 'default', workingDirectory: '/code/lobehub' });
  });
});

describe('buildNewTopicMetadata — Codex Plan switch', () => {
  it('is born with the switch the composer showed, off included', () => {
    for (const heteroPlanMode of [true, false]) {
      expect(
        buildNewTopicMetadata({
          appContext: { initialTopicMetadata: { heteroPlanMode } } as any,
        }),
      ).toMatchObject({ heteroPlanMode });
    }
  });

  it('records nothing when the composer showed no switch', () => {
    expect(
      buildNewTopicMetadata({
        appContext: { initialTopicMetadata: { workingDirectory: '/code/d' } } as any,
      }),
    ).not.toHaveProperty('heteroPlanMode');
  });
});

describe('sub-topic link (metadata.openedBy)', () => {
  it('records the opener read through the caller scope', async () => {
    const findById = vi.fn().mockResolvedValue({ agentId: 'agt_parent', id: 'tpc_parent' });

    const openedBy = await resolveTopicOpenedBy({ findById } as any, 'tpc_parent');

    expect(findById).toHaveBeenCalledWith('tpc_parent');
    expect(openedBy).toEqual({
      agentId: 'agt_parent',
      at: expect.any(String),
      topicId: 'tpc_parent',
    });
    expect(buildNewTopicMetadata({ openedBy })).toEqual(expect.objectContaining({ openedBy }));
  });

  it('records nothing for an unknown or unreadable opener', async () => {
    expect(
      await resolveTopicOpenedBy({ findById: vi.fn().mockResolvedValue(undefined) } as any, 'x'),
    ).toBeUndefined();
    expect(
      await resolveTopicOpenedBy(
        { findById: vi.fn().mockRejectedValue(new Error('no')) } as any,
        'x',
      ),
    ).toBeUndefined();
    expect(await resolveTopicOpenedBy({ findById: vi.fn() } as any, undefined)).toBeUndefined();
  });
});

// A draft's first send in a project: the composer's placement and whether it
// was picked must both reach `withProjectSandbox`, which decides from them
// whether the project's environment applies.
describe('buildNewTopicMetadata — cloud sandbox placement', () => {
  it('carries a temporary sandbox picked on purpose', () => {
    expect(
      buildNewTopicMetadata({
        appContext: { initialTopicMetadata: { sandboxTemporary: true } } as any,
      }),
    ).toMatchObject({ sandboxTemporary: true });
  });

  it('carries a default environment nobody picked as such', () => {
    expect(
      buildNewTopicMetadata({
        appContext: {
          initialTopicMetadata: { sandboxEnvironmentId: 'env-1', sandboxSeeded: true },
        } as any,
      }),
    ).toMatchObject({ sandboxEnvironmentId: 'env-1', sandboxSeeded: true });
  });
});
