import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseWorktreeAddPath,
  recordGitCommandEffects,
  recordWorktreeAdd,
} from '../worktreeDetection';

const chatMocks = vi.hoisted(() => ({
  topics: {} as Record<string, { agentId?: string | null; metadata?: Record<string, any> }>,
  updateTopicMetadata: vi.fn(),
}));

const gitServiceMocks = vi.hoisted(() => ({
  listGitWorktrees: vi.fn(),
}));

const gsMocks = vi.hoisted(() => ({ revalidateGitStatus: vi.fn() }));
vi.mock('@/store/device/gitStatus/store', () => ({ getGitStatusStoreState: () => gsMocks }));

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

describe('recordGitCommandEffects — worktree outside the source filesystem', () => {
  const WSL_SOURCE = '\\\\wsl.localhost\\Ubuntu-22.04\\home\\zhy\\PROJECT\\RefRWKV';

  it('ignores a worktree created inside WSL for a Windows-side source', async () => {
    chatMocks.topics = {
      t1: { metadata: { workingDirectoryConfig: { path: WSL_SOURCE, repoType: 'git' } } },
    };

    // Verbatim production command: runCommand on a Windows device shells into WSL.
    await recordGitCommandEffects({
      command:
        'wsl.exe -d Ubuntu-22.04 -- bash -lc "cd /home/zhy/PROJECT/RefRWKV && git rev-parse 27f78b6^ && git worktree add --detach /tmp/RefRWKV-lsh 27f78b6^"',
      resultContent: 'Preparing worktree (detached HEAD 6692cd5)',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('ignores a POSIX worktree the device reports for a Windows source', async () => {
    chatMocks.topics = {
      t1: { metadata: { workingDirectoryConfig: { path: 'C:\\repo', repoType: 'git' } } },
    };
    gitServiceMocks.listGitWorktrees.mockResolvedValue([{ branch: 'feat/x', path: '/mnt/c/wt' }]);

    await recordGitCommandEffects({
      command: 'git worktree add -b feat/x "$WT"',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('still records a Windows worktree for a Windows source', async () => {
    chatMocks.topics = {
      t1: { metadata: { workingDirectoryConfig: { path: 'C:\\repo', repoType: 'git' } } },
    };

    await recordGitCommandEffects({ command: 'git worktree add C:\\wt', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: 'C:\\wt', isWorktree: true },
        path: 'C:\\repo',
        repoType: 'git',
      },
    });
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

    expect(gsMocks.revalidateGitStatus).toHaveBeenCalledWith(undefined, '/repo', ['branch']);
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

    expect(gsMocks.revalidateGitStatus).toHaveBeenCalledWith('remote-device', '/repo', ['branch']);
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

describe('recordGitCommandEffects — git push', () => {
  /** The topic from the reported case: a worktree branch that never existed on the remote. */
  const WORKTREE_TOPIC = {
    metadata: {
      workingDirectoryConfig: {
        git: { branch: 'worktree-feat+claude-code-session-import' },
        path: '/repo',
        repoType: 'github',
      },
    },
  };

  const pushOutput = (table: string) =>
    ['Enumerating objects: 5, done.', 'To github.com:lobehub/lobehub.git', table].join('\n');

  const upstreamOf = () =>
    chatMocks.updateTopicMetadata.mock.calls.at(-1)?.[1].workingDirectoryConfig.git.upstream;

  // The exact push that broke PR linkage: an explicit refspec renames the branch in
  // flight and sets no upstream, so only the push's own output states the mapping.
  it('records the remote branch an explicit-refspec push landed on', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command:
        'git push origin worktree-feat+claude-code-session-import:feat/hetero-session-import-ui --force',
      resultContent: pushOutput(
        ' + 031bf96...f6b1c2a worktree-feat+claude-code-session-import -> feat/hetero-session-import-ui (forced update)',
      ),
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: {
          branch: 'worktree-feat+claude-code-session-import',
          upstream: { branch: 'feat/hetero-session-import-ui', remote: 'origin' },
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('resolves a HEAD refspec against the topic branch', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command: 'git push -u origin HEAD',
      resultContent: pushOutput(
        ' * [new branch]      HEAD -> worktree-feat+claude-code-session-import',
      ),
      topicId: 't1',
    });

    expect(upstreamOf()).toEqual({
      branch: 'worktree-feat+claude-code-session-import',
      remote: 'origin',
    });
  });

  it('reads a bare push, whose mapping only appears as a SHA range', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command: 'git push',
      resultContent: pushOutput(
        '   031bf96..f6b1c2a  worktree-feat+claude-code-session-import -> feat/hetero-session-import-ui',
      ),
      topicId: 't1',
    });

    expect(upstreamOf()).toEqual({
      branch: 'feat/hetero-session-import-ui',
      remote: 'origin',
    });
  });

  it('names the remote from the command rather than assuming origin', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command: 'git push -o ci.skip fork worktree-feat+claude-code-session-import:feat/y',
      resultContent: pushOutput(
        ' * [new branch]      worktree-feat+claude-code-session-import -> feat/y',
      ),
      topicId: 't1',
    });

    expect(upstreamOf()).toEqual({ branch: 'feat/y', remote: 'fork' });
  });

  it('ignores a rejected push', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command: 'git push origin worktree-feat+claude-code-session-import:feat/y',
      resultContent: pushOutput(
        ' ! [rejected]        worktree-feat+claude-code-session-import -> feat/y (fetch first)',
      ),
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('ignores tag and branch-deletion lines', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command: 'git push origin --tags',
      resultContent: pushOutput(' * [new tag]         v1.2.3 -> v1.2.3'),
      topicId: 't1',
    });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();

    await recordGitCommandEffects({
      command: 'git push origin :feat/y',
      resultContent: pushOutput(' - [deleted]         (none) -> feat/y'),
      topicId: 't1',
    });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('records nothing from a multi-ref push that never names the topic branch', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command: 'git push origin feat/a feat/b',
      resultContent: pushOutput(
        [' * [new branch]      feat/a -> feat/a', ' * [new branch]      feat/b -> feat/b'].join(
          '\n',
        ),
      ),
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('never mistakes prose in the output for a push mapping', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command: 'git push origin worktree-feat+claude-code-session-import:feat/y',
      resultContent: 'renaming worktree-feat+claude-code-session-import -> feat/y in the docs',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  // Re-pointing the branch at a new remote ref orphans the PR bound to the old one.
  it('drops the linked PR when the branch is re-pushed to a different remote ref', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: {
              branch: 'worktree-feat+x',
              github: {
                pullRequest: {
                  number: 1,
                  state: 'OPEN',
                  title: 'old',
                  url: 'https://github.com/lobehub/lobehub/pull/1',
                },
                pullRequestStatus: 'ok',
              },
              upstream: { branch: 'feat/old', remote: 'origin' },
            },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({
      command: 'git push origin worktree-feat+x:feat/new',
      resultContent: pushOutput(' * [new branch]      worktree-feat+x -> feat/new'),
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: {
          branch: 'worktree-feat+x',
          upstream: { branch: 'feat/new', remote: 'origin' },
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  // `gh pr create` then `git push` in one run must not erase the PR it just recorded.
  it('keeps a freshly created PR on the first push to that ref', async () => {
    const pullRequest = {
      number: 17_101,
      state: 'OPEN',
      title: 'feat: import sessions',
      url: 'https://github.com/lobehub/lobehub/pull/17101',
    };
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: {
              branch: 'worktree-feat+x',
              github: { pullRequest, pullRequestStatus: 'ok' },
            },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({
      command: 'git push origin worktree-feat+x:feat/y',
      resultContent: pushOutput(' * [new branch]      worktree-feat+x -> feat/y'),
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: {
          branch: 'worktree-feat+x',
          github: { pullRequest, pullRequestStatus: 'ok' },
          upstream: { branch: 'feat/y', remote: 'origin' },
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('refreshes the branch cache, which now carries the remote ref', async () => {
    chatMocks.topics = { t1: WORKTREE_TOPIC };

    await recordGitCommandEffects({
      command: 'git push origin worktree-feat+claude-code-session-import:feat/y',
      resultContent: pushOutput(
        ' * [new branch]      worktree-feat+claude-code-session-import -> feat/y',
      ),
      topicId: 't1',
    });

    expect(gsMocks.revalidateGitStatus).toHaveBeenCalledWith(undefined, '/repo', ['branch']);
  });
});
