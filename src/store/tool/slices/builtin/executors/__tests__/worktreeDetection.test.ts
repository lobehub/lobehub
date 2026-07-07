import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseWorktreeAddPath, recordWorktreeAdd } from '../worktreeDetection';

const chatMocks = vi.hoisted(() => ({
  topics: {} as Record<string, { metadata?: Record<string, any> }>,
  updateTopicMetadata: vi.fn(),
}));

vi.mock('@/store/chat/store', () => ({
  getChatStoreState: () => chatMocks,
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (state: typeof chatMocks) => state.topics[id],
  },
}));

describe('parseWorktreeAddPath', () => {
  it('resolves a relative path against the source cwd', () => {
    expect(parseWorktreeAddPath('git worktree add ../wt', '/repo')).toBe('/wt');
    expect(parseWorktreeAddPath('git worktree add wt', '/repo')).toBe('/repo/wt');
  });

  it('keeps an absolute path as-is', () => {
    expect(parseWorktreeAddPath('git worktree add /tmp/wt', '/repo')).toBe('/tmp/wt');
  });

  it('skips flags and their values', () => {
    expect(parseWorktreeAddPath('git worktree add -b feature ../feat', '/repo')).toBe('/feat');
    expect(parseWorktreeAddPath('git worktree add --detach /tmp/wt', '/repo')).toBe('/tmp/wt');
  });

  it('stops at a shell separator', () => {
    expect(parseWorktreeAddPath('cd /repo && git worktree add wt && cd wt', '/repo')).toBe(
      '/repo/wt',
    );
  });

  it('preserves argv boundaries for the array form — a path with spaces stays intact', () => {
    expect(parseWorktreeAddPath(['git', 'worktree', 'add', '/tmp/my wt'], '/repo')).toBe(
      '/tmp/my wt',
    );
    expect(parseWorktreeAddPath(['git', 'worktree', 'add', 'my wt'], '/repo')).toBe('/repo/my wt');
  });

  it('requires an actual git invocation — not the words in another command', () => {
    expect(parseWorktreeAddPath('echo git worktree add ../wt', '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath('rg "git worktree add" .', '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath('grep -r "worktree add" src', '/repo')).toBeUndefined();
  });

  it('accepts wrappers and git global options', () => {
    expect(parseWorktreeAddPath('sudo git worktree add /wt', '/repo')).toBe('/wt');
    expect(parseWorktreeAddPath('git -C /elsewhere worktree add wt', '/repo')).toBe(
      '/elsewhere/wt',
    );
    expect(parseWorktreeAddPath('git -c core.hooksPath=/x worktree add /wt', '/repo')).toBe('/wt');
  });

  it('returns undefined for non-worktree-add calls', () => {
    expect(parseWorktreeAddPath('git status', '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath('git worktree list', '/repo')).toBeUndefined();
  });
});

const PR_TOPIC = {
  metadata: { workingDirectoryConfig: { path: '/repo', repoType: 'github' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  chatMocks.topics = {};
});

describe('recordWorktreeAdd', () => {
  it('records the new worktree onto the given (run) topic', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordWorktreeAdd({ command: 'git worktree add ../wt', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/wt', isWorktree: true },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('targets the passed topicId, not the active one', async () => {
    chatMocks.topics = { other: PR_TOPIC, t1: PR_TOPIC };

    await recordWorktreeAdd({ command: 'git worktree add /wt', topicId: 'other' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('other', expect.anything());
  });

  it('does nothing when the worktree resolves to the source path', async () => {
    chatMocks.topics = { t1: { metadata: { workingDirectoryConfig: { path: '/repo' } } } };
    await recordWorktreeAdd({ command: 'git worktree add /repo', topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('is idempotent when the active worktree is already set', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: { activeWorktree: '/wt', isWorktree: true },
            path: '/repo',
          },
        },
      },
    };
    await recordWorktreeAdd({ command: 'git worktree add /wt', topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('does nothing for a non-worktree command', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    await recordWorktreeAdd({ command: 'ls -la', topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });
});
