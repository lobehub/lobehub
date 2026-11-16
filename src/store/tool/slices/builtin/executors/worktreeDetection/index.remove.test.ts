import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordGitCommandEffects } from '.';

const listGitWorktrees = vi.hoisted(() => vi.fn());

const chatMocks = vi.hoisted(() => ({
  topics: {} as Record<string, { metadata?: Record<string, any> }>,
  updateTopicMetadata: vi.fn(),
}));

vi.mock('@/store/device/gitStatus/store', () => ({
  getGitStatusStoreState: () => ({ revalidateGitStatus: vi.fn() }),
}));

vi.mock('@/store/chat/store', () => ({
  getChatStoreState: () => chatMocks,
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (state: typeof chatMocks) => state.topics[id],
  },
}));

vi.mock('@/services/git', () => ({
  gitService: { listGitWorktrees },
}));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: 'device-1' } }),
}));

const setTopicWorktree = (activeWorktree: string) => {
  chatMocks.topics = {
    t1: {
      metadata: {
        workingDirectoryConfig: {
          git: { activeWorktree, branch: 'fix/tab-nav', isWorktree: true },
          path: '/repo',
        },
      },
    },
  };
};

// Regression: a run that added a scratch worktree, pushed from it and then
// removed it kept the topic's `activeWorktree`, so every later run in that
// conversation failed with "working directory does not exist".
describe('recordGitCommandEffects — git worktree remove', () => {
  beforeEach(() => {
    chatMocks.updateTopicMetadata.mockReset();
    // The device's view after the command: only the source checkout is left.
    listGitWorktrees.mockReset();
    listGitWorktrees.mockResolvedValue([{ branch: 'main', path: '/repo' }]);
  });

  it('returns the topic to its source repo when the active worktree is removed', async () => {
    setTopicWorktree('/tmp/repo-push');

    await recordGitCommandEffects({
      command:
        'git worktree remove /tmp/repo-push && git branch -D fix/tab-nav -q; git status --short',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('resolves a relative path and skips flags', async () => {
    setTopicWorktree('/repo/.worktrees/wt');

    await recordGitCommandEffects({
      command: 'git worktree remove --force .worktrees/wt',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('expands a variable used as the git -C directory', async () => {
    setTopicWorktree('/repo/.worktrees/wt');

    await recordGitCommandEffects({
      command: 'BASE=/repo; git -C "$BASE" worktree remove .worktrees/wt',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('handles the shell-wrapped argv form', async () => {
    setTopicWorktree('/tmp/wt');

    await recordGitCommandEffects({
      command: ['/bin/zsh', '-lc', 'git worktree remove /tmp/wt'],
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledTimes(1);
  });

  it('still clears the active worktree when the command removes another one after it', async () => {
    setTopicWorktree('/tmp/wt');

    await recordGitCommandEffects({
      command: 'git worktree remove /tmp/wt && git worktree remove /tmp/other',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('keeps the worktree when a conditional removal never ran on the device', async () => {
    setTopicWorktree('/tmp/wt');
    listGitWorktrees.mockResolvedValue([
      { branch: 'main', path: '/repo' },
      { branch: 'fix/tab-nav', path: '/tmp/wt' },
    ]);

    await recordGitCommandEffects({
      command: 'test -f marker && git worktree remove /tmp/wt || true',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('keeps the worktree when the device cannot confirm the removal', async () => {
    setTopicWorktree('/tmp/wt');
    listGitWorktrees.mockRejectedValue(new Error('device offline'));

    await recordGitCommandEffects({ command: 'git worktree remove /tmp/wt', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('keeps the worktree when the device returns an empty worktree list', async () => {
    setTopicWorktree('/tmp/wt');
    listGitWorktrees.mockResolvedValue([]);

    await recordGitCommandEffects({
      command: 'git worktree remove /tmp/wt || true',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('keeps a worktree the device lists under its canonical path', async () => {
    setTopicWorktree('/tmp/link/wt');
    listGitWorktrees.mockResolvedValue([
      { branch: 'main', path: '/repo' },
      { branch: 'fix/tab-nav', path: '/private/tmp/real/wt' },
    ]);

    await recordGitCommandEffects({
      command: 'test -f marker && git worktree remove /tmp/link/wt || true',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('keeps a Windows worktree listed with different separators and case', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: { activeWorktree: 'C:\\Repo\\wt', isWorktree: true },
            path: 'C:\\Repo',
          },
        },
      },
    };
    listGitWorktrees.mockResolvedValue([
      { branch: 'main', path: 'C:/Repo' },
      { branch: 'wt', path: 'c:/repo/wt' },
    ]);

    await recordGitCommandEffects({
      command: 'git worktree remove C:\\Repo\\wt || true',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('matches a removal spelled differently from the recorded path', async () => {
    setTopicWorktree('/tmp/wt');

    await recordGitCommandEffects({ command: 'git worktree remove /tmp/wt/', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('matches a Windows removal with different separators and case', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: { activeWorktree: 'C:\\Repo\\wt', isWorktree: true },
            path: 'C:\\Repo',
          },
        },
      },
    };
    listGitWorktrees.mockResolvedValue([{ branch: 'main', path: 'C:/Repo' }]);

    await recordGitCommandEffects({ command: 'git worktree remove c:/repo/wt', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: 'C:\\Repo' },
    });
  });

  it('drops the branch and PR of a hand-picked worktree when it is removed', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: {
              activeWorktree: '/tmp/wt',
              branch: 'feat/x',
              github: { pullRequest: { number: 7, url: 'https://github.com/o/r/pull/7' } },
            },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({ command: 'git worktree remove /tmp/wt', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo', repoType: 'github' },
    });
  });

  it('records the last worktree when a command adds, removes and adds again', async () => {
    chatMocks.topics = { t1: { metadata: { workingDirectoryConfig: { path: '/repo' } } } };
    listGitWorktrees.mockResolvedValue([
      { branch: 'main', path: '/repo' },
      { branch: 'b', path: '/tmp/b' },
    ]);

    await recordGitCommandEffects({
      command:
        'git worktree add /tmp/a -b a && git worktree remove /tmp/a && git worktree add /tmp/b -b b',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/tmp/b', branch: 'b', isWorktree: true },
        path: '/repo',
      },
    });
  });

  it('keeps the active worktree when another worktree is removed', async () => {
    setTopicWorktree('/tmp/wt');

    await recordGitCommandEffects({ command: 'git worktree remove /tmp/other', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('ignores a command that only mentions worktree remove', async () => {
    setTopicWorktree('/tmp/wt');

    await recordGitCommandEffects({ command: 'echo git worktree remove /tmp/wt', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('keeps a worktree that the same command removes and then recreates', async () => {
    setTopicWorktree('/tmp/wt');

    await recordGitCommandEffects({
      command: 'git worktree remove /tmp/wt && git worktree add /tmp/wt -b fresh',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/tmp/wt', branch: 'fresh', isWorktree: true },
        path: '/repo',
      },
    });
  });

  it('ends on the source repo when one command adds and removes the same worktree', async () => {
    chatMocks.topics = { t1: { metadata: { workingDirectoryConfig: { path: '/repo' } } } };

    await recordGitCommandEffects({
      command: 'git worktree add /tmp/wt -b tmp && git worktree remove /tmp/wt',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });
});
