// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildNewTopicMetadata } from './newTopicMetadata';

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
