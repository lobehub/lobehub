import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isWorktreeExitContent,
  parseWorktreeAddPath,
  parseWorktreeEnterInfo,
  recordGitCommandEffects,
  recordWorktreeAdd,
  recordWorktreeEnter,
  recordWorktreeExit,
} from '../worktreeDetection';

const chatMocks = vi.hoisted(() => ({
  topics: {} as Record<string, { agentId?: string | null; metadata?: Record<string, any> }>,
  updateTopicMetadata: vi.fn(),
}));

const gitServiceMocks = vi.hoisted(() => ({
  listGitWorktrees: vi.fn(),
}));

const swrMocks = vi.hoisted(() => ({
  mutate: vi.fn(),
}));

vi.mock('@/libs/swr', () => swrMocks);

vi.mock('@/store/chat/store', () => ({
  getChatStoreState: () => chatMocks,
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (state: typeof chatMocks) => state.topics[id],
  },
}));

vi.mock('@/services/git', () => ({
  gitService: gitServiceMocks,
}));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: 'device-1' } }),
}));

describe('parseWorktreeAddPath', () => {
  it('resolves a relative path against the source cwd', () => {
    expect(parseWorktreeAddPath('git worktree add ../wt', '/repo')).toBe('/wt');
    expect(parseWorktreeAddPath('git worktree add wt', '/repo')).toBe('/repo/wt');
  });

  it('accepts absolute git executable paths', () => {
    expect(parseWorktreeAddPath('/usr/bin/git worktree add ../wt', '/repo')).toBe('/wt');
    expect(parseWorktreeAddPath(['/usr/bin/git', 'worktree', 'add', '/tmp/wt'], '/repo')).toBe(
      '/tmp/wt',
    );
  });

  it('keeps an absolute path as-is', () => {
    expect(parseWorktreeAddPath('git worktree add /tmp/wt', '/repo')).toBe('/tmp/wt');
  });

  it('skips flags and their values', () => {
    expect(parseWorktreeAddPath('git worktree add -b feature ../feat', '/repo')).toBe('/feat');
    expect(parseWorktreeAddPath('git worktree add --detach /tmp/wt', '/repo')).toBe('/tmp/wt');
    expect(parseWorktreeAddPath('git worktree add --orphan ../orphan', '/repo')).toBe('/orphan');
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

  it('expands a variable assigned earlier in the same command', () => {
    expect(
      parseWorktreeAddPath(
        'cd /repo\nWT=/tmp/wt-lobe11099\nrm -rf "$WT"\ngit worktree add "$WT" feat/x 2>&1 | tail -2',
        '/repo',
      ),
    ).toBe('/tmp/wt-lobe11099');
  });

  it('expands ${VAR} and semicolon-separated assignments, resolving relative results', () => {
    expect(parseWorktreeAddPath('WT=../wt; git worktree add "${WT}"', '/repo')).toBe('/wt');
  });

  it('expands export assignments and variables referencing earlier variables', () => {
    expect(
      parseWorktreeAddPath('export ROOT=/tmp; WT="$ROOT/wt"; git worktree add "$WT"', '/repo'),
    ).toBe('/tmp/wt');
  });

  it('never expands single-quoted tokens, per shell semantics', () => {
    expect(parseWorktreeAddPath("WT=/tmp/wt; git worktree add '$WT'", '/repo')).toBeUndefined();
  });

  it('does not leak a command-scoped assignment prefix into later expansion', () => {
    expect(parseWorktreeAddPath('WT=/tmp/wt git status; git worktree add "$WT"', '/repo')).toBe(
      undefined,
    );
  });

  it('returns undefined instead of an unexpandable literal', () => {
    expect(parseWorktreeAddPath('git worktree add "$WT" feat/x', '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath('git worktree add $(mktemp -d) feat/x', '/repo')).toBeUndefined();
    expect(parseWorktreeAddPath('git worktree add ~/wt feat/x', '/repo')).toBeUndefined();
  });

  it('unwraps the Codex login-shell wrapper', () => {
    expect(parseWorktreeAddPath('/bin/zsh -lc "git worktree add -b feat/x ../wt"', '/repo')).toBe(
      '/wt',
    );
    expect(parseWorktreeAddPath("bash -lc 'git worktree add /tmp/wt'", '/repo')).toBe('/tmp/wt');
    expect(parseWorktreeAddPath('sh -c "git worktree add wt"', '/repo')).toBe('/repo/wt');
    expect(parseWorktreeAddPath('/usr/bin/env bash -l -c "git worktree add /wt"', '/repo')).toBe(
      '/wt',
    );
  });

  it('unwraps the argv form of the shell wrapper', () => {
    expect(
      parseWorktreeAddPath(['/bin/zsh', '-lc', 'git worktree add -b feat/x /tmp/wt'], '/repo'),
    ).toBe('/tmp/wt');
    expect(parseWorktreeAddPath(['bash', '-l', '-c', 'git worktree add ../wt'], '/repo')).toBe(
      '/wt',
    );
  });

  it('handles separators, escaped quotes, and nesting inside the wrapper payload', () => {
    expect(
      parseWorktreeAddPath('/bin/zsh -lc "cd /repo && git worktree add \\"/tmp/my wt\\""', '/repo'),
    ).toBe('/tmp/my wt');
    expect(parseWorktreeAddPath(`zsh -lc 'bash -c "git worktree add /tmp/wt"'`, '/repo')).toBe(
      '/tmp/wt',
    );
  });

  it('still rejects non-git payloads inside a wrapper', () => {
    expect(
      parseWorktreeAddPath('/bin/zsh -lc "echo git worktree add /wt"', '/repo'),
    ).toBeUndefined();
    expect(parseWorktreeAddPath(`/bin/zsh -lc "rg 'git worktree add' ."`, '/repo')).toBeUndefined();
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

  it('records the explicit created branch from worktree add', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordWorktreeAdd({
      command: '/usr/bin/git worktree add -b codex/claude-task-notification-callback ../wt HEAD',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: {
          activeWorktree: '/wt',
          branch: 'codex/claude-task-notification-callback',
          isWorktree: true,
        },
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

describe('recordGitCommandEffects', () => {
  it('refreshes the local branch cache when the run is bound to this device', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          boundDeviceId: 'device-1',
          workingDirectoryConfig: {
            git: { branch: 'canary' },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({ command: 'git switch fix/topic', topicId: 't1' });

    expect(swrMocks.mutate).toHaveBeenCalledWith(['device:gitBranch', 'local', '/repo']);
  });

  it('refreshes the remote-device branch cache after a branch switch', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          boundDeviceId: 'remote-device',
          workingDirectoryConfig: {
            git: { branch: 'canary' },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({ command: 'git switch fix/topic', topicId: 't1' });

    expect(swrMocks.mutate).toHaveBeenCalledWith(['device:gitBranch', 'remote-device', '/repo']);
  });

  it('updates the topic branch when the agent switches branch with git switch', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: {
              branch: 'canary',
              github: {
                pullRequest: {
                  number: 1,
                  state: 'OPEN',
                  title: 'old',
                  url: 'https://github.com/lobehub/lobehub/pull/1',
                },
                pullRequestStatus: 'ok',
              },
            },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({ command: 'git switch fix/topic', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { branch: 'fix/topic' },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('updates the topic branch from confirmed git checkout output', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordGitCommandEffects({
      command: 'git checkout fix/from-output',
      resultContent: "Switched to branch 'fix/from-output'",
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { branch: 'fix/from-output' },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('does not infer ambiguous bare git checkout without confirming output', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordGitCommandEffects({ command: 'git checkout package.json', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('marks detached switch commands without recording the commit-ish as a branch', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: {
              branch: 'canary',
              github: {
                pullRequest: {
                  number: 1,
                  state: 'OPEN',
                  title: 'old',
                  url: 'https://github.com/lobehub/lobehub/pull/1',
                },
                pullRequestStatus: 'ok',
              },
            },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({ command: 'git switch --detach HEAD', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { detached: true },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('binds a created GitHub PR from gh pr create output', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: { branch: 'fix/topic' },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({
      command: 'gh pr create --title "Fix topic" --draft',
      resultContent: 'https://github.com/lobehub/lobehub/pull/456',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: {
          branch: 'fix/topic',
          github: {
            pullRequest: {
              isDraft: true,
              number: 456,
              state: 'OPEN',
              title: 'Fix topic',
              url: 'https://github.com/lobehub/lobehub/pull/456',
            },
            pullRequestStatus: 'ok',
          },
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('records a worktree add shipped through the Codex zsh wrapper', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordGitCommandEffects({
      command: '/bin/zsh -lc "git worktree add -b feat/agent-testing-s3rver /Users/me/wt canary"',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: {
          activeWorktree: '/Users/me/wt',
          branch: 'feat/agent-testing-s3rver',
          isWorktree: true,
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('updates the branch from a wrapped git switch', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordGitCommandEffects({
      command: 'bash -lc "git switch fix/topic"',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { branch: 'fix/topic' },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('binds a created PR from a wrapped gh pr create', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordGitCommandEffects({
      command: `/bin/zsh -lc "gh pr create --title 'Fix topic'"`,
      resultContent: 'https://github.com/lobehub/lobehub/pull/456',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: {
          github: {
            pullRequest: {
              number: 456,
              state: 'OPEN',
              title: 'Fix topic',
              url: 'https://github.com/lobehub/lobehub/pull/456',
            },
            pullRequestStatus: 'ok',
          },
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('does not query the device when the worktree path parses statically', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordGitCommandEffects({ command: 'git worktree add /wt', topicId: 't1' });

    expect(gitServiceMocks.listGitWorktrees).not.toHaveBeenCalled();
    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/wt', isWorktree: true },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('resolves an unparseable $VAR worktree path from the device list by branch', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    gitServiceMocks.listGitWorktrees.mockResolvedValue([
      { branch: 'canary', current: true, path: '/repo' },
      { branch: 'feat/x', current: false, path: '/repo-feat-x' },
    ]);

    await recordGitCommandEffects({ command: 'git worktree add "$WT" feat/x', topicId: 't1' });

    expect(gitServiceMocks.listGitWorktrees).toHaveBeenCalledWith({
      deviceId: 'device-1',
      path: '/repo',
    });
    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo-feat-x', branch: 'feat/x', isWorktree: true },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('queries the topic-bound device when the run was dispatched to one', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          boundDeviceId: 'device-9',
          workingDirectoryConfig: { path: '/repo', repoType: 'github' },
        },
      },
    };
    gitServiceMocks.listGitWorktrees.mockResolvedValue([
      { branch: 'feat/x', current: false, path: '/repo-feat-x' },
    ]);

    await recordGitCommandEffects({ command: 'git worktree add "$WT" feat/x', topicId: 't1' });

    expect(gitServiceMocks.listGitWorktrees).toHaveBeenCalledWith({
      deviceId: 'device-9',
      path: '/repo',
    });
  });

  it('matches the device list by the -b created branch', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    gitServiceMocks.listGitWorktrees.mockResolvedValue([
      { branch: 'feat/y', current: false, path: '/repo-feat-y' },
    ]);

    await recordGitCommandEffects({
      command: 'WT=$(mktemp -d); git worktree add -b feat/y "$WT"',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo-feat-y', branch: 'feat/y', isWorktree: true },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('fails closed when the branch hint matches no worktree', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    gitServiceMocks.listGitWorktrees.mockResolvedValue([
      { branch: 'canary', current: true, path: '/repo' },
    ]);

    await recordGitCommandEffects({ command: 'git worktree add "$WT" feat/x', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('fails closed when there is no usable branch hint', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordGitCommandEffects({ command: 'git worktree add "$WT" "$BRANCH"', topicId: 't1' });

    expect(gitServiceMocks.listGitWorktrees).not.toHaveBeenCalled();
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('fails closed when the device query rejects', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    gitServiceMocks.listGitWorktrees.mockRejectedValue(new Error('device offline'));

    await recordGitCommandEffects({ command: 'git worktree add "$WT" feat/x', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('uses gh pr create --head as the topic branch when present', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordGitCommandEffects({
      command: 'gh pr create --head arvinxx:fix/head-branch --title "Head branch"',
      resultContent: 'Created pull request: https://github.com/lobehub/lobehub/pull/789',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: {
          branch: 'fix/head-branch',
          github: {
            pullRequest: {
              number: 789,
              state: 'OPEN',
              title: 'Head branch',
              url: 'https://github.com/lobehub/lobehub/pull/789',
            },
            pullRequestStatus: 'ok',
          },
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });
});

/**
 * Verbatim `EnterWorktree` / `ExitWorktree` result messages, matching the templates
 * Claude Code builds in its `call()`. Only `message` crosses the wire as the
 * tool_result content, so these strings ARE the contract this module parses.
 */
const SESSION_TAIL =
  'The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.';
const enterCreated = (path: string, branch?: string) =>
  `Created worktree at ${path}${branch ? ` on branch ${branch}` : ''}. ${SESSION_TAIL}`;
const enterExisting = (path: string) => `Entered worktree at ${path}. ${SESSION_TAIL}`;
/** A subagent pinned to its own cwd — it moved only itself, never the session. */
const enterPinnedAgent = (path: string) =>
  `Entered worktree at ${path} on branch worktree-x. This agent's working directory and write access now point at the worktree; the previous directory was left untouched.`;

describe('parseWorktreeEnterInfo', () => {
  it('reads path and branch out of a created-worktree message', () => {
    expect(parseWorktreeEnterInfo(enterCreated('/repo/.claude/worktrees/a', 'worktree-a'))).toEqual(
      {
        branch: 'worktree-a',
        path: '/repo/.claude/worktrees/a',
      },
    );
  });

  it('omits the branch when the message has none', () => {
    expect(parseWorktreeEnterInfo(enterCreated('/repo/wt'))).toEqual({ path: '/repo/wt' });
  });

  it('reads the path when switching into an existing worktree', () => {
    expect(parseWorktreeEnterInfo(enterExisting('/tmp/wt'))).toEqual({ path: '/tmp/wt' });
  });

  it('keeps a path containing spaces intact', () => {
    expect(parseWorktreeEnterInfo(enterCreated('/tmp/my wt', 'worktree-b'))?.path).toBe(
      '/tmp/my wt',
    );
  });

  it('ignores a subagent that moved only its own pinned cwd', () => {
    expect(parseWorktreeEnterInfo(enterPinnedAgent('/tmp/wt'))).toBeUndefined();
  });

  it('ignores unrelated, truncated or empty content', () => {
    expect(parseWorktreeEnterInfo('')).toBeUndefined();
    expect(parseWorktreeEnterInfo(undefined)).toBeUndefined();
    expect(parseWorktreeEnterInfo('Created worktree at /tmp/wt.')).toBeUndefined();
  });
});

describe('isWorktreeExitContent', () => {
  it('accepts every successful exit outcome', () => {
    expect(
      isWorktreeExitContent(
        'Exited worktree. Your work is preserved at /tmp/wt on branch worktree-a. Session is now back in /repo.',
      ),
    ).toBe(true);
    expect(
      isWorktreeExitContent(
        'Exited and removed worktree at /tmp/wt. Discarded 3 uncommitted files. Session is now back in /repo.',
      ),
    ).toBe(true);
    expect(
      isWorktreeExitContent(
        'Exited worktree but could not remove it — kept at /tmp/wt. Session is now back in /repo.',
      ),
    ).toBe(true);
  });

  it('rejects the no-op and anything else', () => {
    expect(isWorktreeExitContent('No-op: there is no active EnterWorktree session to exit.')).toBe(
      false,
    );
    expect(isWorktreeExitContent(undefined)).toBe(false);
  });
});

describe('recordWorktreeEnter', () => {
  it('records the worktree and its branch onto the run topic', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordWorktreeEnter({ content: enterCreated('/repo/wt', 'worktree-a'), topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo/wt', branch: 'worktree-a', isWorktree: true },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('does not record a subagent-only worktree move', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    await recordWorktreeEnter({ content: enterPinnedAgent('/repo/wt'), topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('does nothing when the worktree resolves to the source path', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    await recordWorktreeEnter({ content: enterExisting('/repo'), topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('is idempotent when already in that worktree', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: { activeWorktree: '/repo/wt', isWorktree: true },
            path: '/repo',
          },
        },
      },
    };
    await recordWorktreeEnter({ content: enterExisting('/repo/wt'), topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });
});

describe('recordWorktreeExit', () => {
  const IN_WORKTREE = {
    metadata: {
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo/wt', branch: 'worktree-a', isWorktree: true },
        path: '/repo',
      },
    },
  };

  it('clears the worktree when the session exits and keeps it on disk', async () => {
    chatMocks.topics = { t1: IN_WORKTREE };

    await recordWorktreeExit({
      content: 'Exited worktree. Your work is preserved at /repo/wt. Session is now back in /repo.',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('clears the worktree when it is removed', async () => {
    chatMocks.topics = { t1: IN_WORKTREE };

    await recordWorktreeExit({
      content: 'Exited and removed worktree at /repo/wt. Session is now back in /repo.',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('drops the linked PR with the worktree branch it belonged to', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: {
              activeWorktree: '/repo/wt',
              branch: 'worktree-a',
              github: { pullRequest: { number: 7 }, pullRequestStatus: 'ok' },
              isWorktree: true,
            },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordWorktreeExit({
      content: 'Exited and removed worktree at /repo/wt.',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo', repoType: 'github' },
    });
  });

  it('does nothing for the no-op exit message', async () => {
    chatMocks.topics = { t1: IN_WORKTREE };
    await recordWorktreeExit({
      content: 'No-op: there is no active EnterWorktree session to exit.',
      topicId: 't1',
    });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('does nothing when the topic is not in a worktree', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    await recordWorktreeExit({
      content: 'Exited and removed worktree at /repo/wt.',
      topicId: 't1',
    });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });
});
