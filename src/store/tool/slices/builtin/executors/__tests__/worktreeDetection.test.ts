import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyWorktreeAddFromToolCall, parseWorktreeAddPath } from '../worktreeDetection';

const chatMocks = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
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
  const cmd = (command: unknown) => ({ command });

  it('resolves a relative path against the source cwd', () => {
    expect(parseWorktreeAddPath(cmd('git worktree add ../wt'), '/repo')).toBe('/wt');
    expect(parseWorktreeAddPath(cmd('git worktree add wt'), '/repo')).toBe('/repo/wt');
  });

  it('keeps an absolute path as-is', () => {
    expect(parseWorktreeAddPath(cmd('git worktree add /tmp/wt'), '/repo')).toBe('/tmp/wt');
  });

  it('skips flags and their values', () => {
    expect(parseWorktreeAddPath(cmd('git worktree add -b feature ../feat'), '/repo')).toBe('/feat');
    expect(parseWorktreeAddPath(cmd('git worktree add --detach /tmp/wt'), '/repo')).toBe('/tmp/wt');
  });

  it('stops at a shell separator', () => {
    expect(parseWorktreeAddPath(cmd('cd /repo && git worktree add wt && cd wt'), '/repo')).toBe(
      '/repo/wt',
    );
  });

  it('joins an argv-array command (Codex shell shape)', () => {
    expect(parseWorktreeAddPath(cmd(['git', 'worktree', 'add', '/tmp/wt']), '/repo')).toBe(
      '/tmp/wt',
    );
  });

  it('reads only `command`, never `content` (writeFile is safe)', () => {
    expect(
      parseWorktreeAddPath({ content: 'run: git worktree add /wt', file_path: 'a.md' }, '/repo'),
    ).toBeUndefined();
  });

  it('requires an actual git invocation — not the words in another command (P2)', () => {
    expect(parseWorktreeAddPath(cmd('echo git worktree add ../wt'), '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath(cmd('rg "git worktree add" .'), '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath(cmd('grep -r "worktree add" src'), '/repo')).toBeUndefined();
  });

  it('accepts wrappers and git global options', () => {
    expect(parseWorktreeAddPath(cmd('sudo git worktree add /wt'), '/repo')).toBe('/wt');
    expect(parseWorktreeAddPath(cmd('git -C /elsewhere worktree add wt'), '/repo')).toBe(
      '/elsewhere/wt',
    );
    expect(parseWorktreeAddPath(cmd('git -c core.hooksPath=/x worktree add /wt'), '/repo')).toBe(
      '/wt',
    );
  });

  it('returns undefined for non-worktree-add calls', () => {
    expect(parseWorktreeAddPath(cmd('git status'), '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath(cmd('git worktree list'), '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath({ file_path: '/x' }, '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath(undefined, '/repo')).toBeUndefined();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  chatMocks.activeTopicId = undefined;
  chatMocks.topics = {};
});

describe('applyWorktreeAddFromToolCall', () => {
  it('records the new worktree onto the active topic', async () => {
    chatMocks.activeTopicId = 't1';
    chatMocks.topics = {
      t1: { metadata: { workingDirectoryConfig: { path: '/repo', repoType: 'github' } } },
    };

    await applyWorktreeAddFromToolCall({ command: 'git worktree add ../wt' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/wt', isWorktree: true },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('does nothing when there is no active topic', async () => {
    chatMocks.activeTopicId = undefined;
    await applyWorktreeAddFromToolCall({ command: 'git worktree add /wt' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('does nothing when the worktree resolves to the source path', async () => {
    chatMocks.activeTopicId = 't1';
    chatMocks.topics = { t1: { metadata: { workingDirectoryConfig: { path: '/repo' } } } };
    await applyWorktreeAddFromToolCall({ command: 'git worktree add /repo' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('is idempotent when the active worktree is already set', async () => {
    chatMocks.activeTopicId = 't1';
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
    await applyWorktreeAddFromToolCall({ command: 'git worktree add /wt' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('does nothing for a non-worktree command', async () => {
    chatMocks.activeTopicId = 't1';
    chatMocks.topics = { t1: { metadata: { workingDirectoryConfig: { path: '/repo' } } } };
    await applyWorktreeAddFromToolCall({ command: 'ls -la' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });
});
