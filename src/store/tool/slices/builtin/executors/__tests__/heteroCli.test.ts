import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claudeCodeExecutor,
  codexExecutor,
  droidExecutor,
  grokBuildExecutor,
  kimiCodeExecutor,
  openCodeExecutor,
  piExecutor,
  qoderExecutor,
  traeExecutor,
} from '../heteroCli';

const detectMocks = vi.hoisted(() => ({
  recordGitCommandEffects: vi.fn(),
  recordWorktreeEnter: vi.fn(),
  recordWorktreeExit: vi.fn(),
}));

vi.mock('../worktreeDetection', () => ({
  recordGitCommandEffects: detectMocks.recordGitCommandEffects,
  recordWorktreeEnter: detectMocks.recordWorktreeEnter,
  recordWorktreeExit: detectMocks.recordWorktreeExit,
}));

const call = (over: Record<string, any> = {}) => ({
  apiName: 'Bash',
  identifier: 'claude-code',
  params: { command: 'git worktree add /wt' },
  result: { content: '', success: true },
  topicId: 't1',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('heteroCli executors', () => {
  it('registers the CLI adapter identifiers and exposes no invokable APIs', () => {
    expect(claudeCodeExecutor.identifier).toBe('claude-code');
    expect(codexExecutor.identifier).toBe('codex');
    expect(droidExecutor.identifier).toBe('droid');
    expect(grokBuildExecutor.identifier).toBe('grok-build');
    expect(kimiCodeExecutor.identifier).toBe('kimi-code');
    expect(openCodeExecutor.identifier).toBe('opencode');
    expect(piExecutor.identifier).toBe('pi');
    expect(qoderExecutor.identifier).toBe('qoder');
    expect(traeExecutor.identifier).toBe('trae');
    // Empty apiEnum → never treated as an invokable client tool.
    expect(claudeCodeExecutor.hasApi('Bash')).toBe(false);
    expect(claudeCodeExecutor.getApiNames()).toEqual([]);
    expect(grokBuildExecutor.hasApi('execute')).toBe(false);
    expect(grokBuildExecutor.getApiNames()).toEqual([]);
    expect(droidExecutor.getApiNames()).toEqual([]);
  });

  it('records the worktree for a successful shell call, keyed by the run topic', async () => {
    await claudeCodeExecutor.onAfterCall!(call());
    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'git worktree add /wt',
      resultContent: '',
      topicId: 't1',
    });
  });

  it('passes an argv-array command through verbatim (boundaries preserved)', async () => {
    await codexExecutor.onAfterCall!(
      call({
        apiName: 'command_execution',
        identifier: 'codex',
        params: { command: ['git', 'worktree', 'add', '/tmp/my wt'] },
      }),
    );
    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: ['git', 'worktree', 'add', '/tmp/my wt'],
      resultContent: '',
      topicId: 't1',
    });
  });

  it('observes Grok Build execute calls for worktree side effects', async () => {
    await grokBuildExecutor.onAfterCall!(
      call({
        apiName: 'execute',
        identifier: 'grok-build',
        params: { command: 'git worktree add /tmp/grok-wt' },
      }),
    );

    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'git worktree add /tmp/grok-wt',
      resultContent: '',
      topicId: 't1',
    });
  });

  it('observes OpenCode bash calls for worktree side effects', async () => {
    await openCodeExecutor.onAfterCall!(
      call({
        apiName: 'bash',
        identifier: 'opencode',
        params: { command: 'git worktree add /tmp/opencode-wt' },
      }),
    );

    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'git worktree add /tmp/opencode-wt',
      resultContent: '',
      topicId: 't1',
    });
  });

  it('observes Kimi Code Shell calls for worktree side effects', async () => {
    await kimiCodeExecutor.onAfterCall!(
      call({
        apiName: 'Shell',
        identifier: 'kimi-code',
        params: { command: 'git worktree add /tmp/kimi-wt' },
      }),
    );

    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'git worktree add /tmp/kimi-wt',
      resultContent: '',
      topicId: 't1',
    });
  });

  it('observes Pi bash calls for worktree side effects', async () => {
    await piExecutor.onAfterCall!(
      call({
        apiName: 'bash',
        identifier: 'pi',
        params: { command: 'git worktree add /tmp/pi-wt' },
      }),
    );

    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'git worktree add /tmp/pi-wt',
      resultContent: '',
      topicId: 't1',
    });
  });

  it('observes Qoder Bash calls for worktree side effects', async () => {
    await qoderExecutor.onAfterCall!(
      call({
        identifier: 'qoder',
        params: { command: 'git worktree add /tmp/qoder-wt' },
      }),
    );

    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'git worktree add /tmp/qoder-wt',
      resultContent: '',
      topicId: 't1',
    });
  });

  it('passes shell output through for branch and PR detection', async () => {
    await claudeCodeExecutor.onAfterCall!(
      call({
        params: { command: 'gh pr create --title "fix thing"' },
        result: {
          content: 'https://github.com/lobehub/lobehub/pull/123',
          success: true,
        },
      }),
    );

    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'gh pr create --title "fix thing"',
      resultContent: 'https://github.com/lobehub/lobehub/pull/123',
      topicId: 't1',
    });
  });

  it('skips a failed call', async () => {
    await claudeCodeExecutor.onAfterCall!(call({ result: { content: 'fatal', success: false } }));
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  it('skips when there is no run topic', async () => {
    await claudeCodeExecutor.onAfterCall!(call({ topicId: undefined }));
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  it('is constrained to the shell tool — ignores other tools', async () => {
    // A non-shell tool (e.g. Write) whose params happen to carry `content`.
    await claudeCodeExecutor.onAfterCall!(
      call({ apiName: 'Write', params: { command: 'git worktree add /wt' } }),
    );
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  it('reads only command/cmd, never content', async () => {
    await claudeCodeExecutor.onAfterCall!(
      call({ params: { content: 'git worktree add /wt', file_path: 'a.md' } }),
    );
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  describe("CC's native worktree tools", () => {
    it('routes EnterWorktree to the enter recorder with the result message', async () => {
      const content = 'Created worktree at /repo/wt. The session is now working in the worktree.';
      await claudeCodeExecutor.onAfterCall!(
        call({
          apiName: 'EnterWorktree',
          params: { name: 'wt' },
          result: { content, success: true },
        }),
      );

      expect(detectMocks.recordWorktreeEnter).toHaveBeenCalledWith({ content, topicId: 't1' });
      // The worktree tools never shell out — no command sniffing.
      expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
    });

    it('routes ExitWorktree to the exit recorder', async () => {
      const content = 'Exited and removed worktree at /repo/wt. Session is now back in /repo.';
      await claudeCodeExecutor.onAfterCall!(
        call({
          apiName: 'ExitWorktree',
          params: { action: 'remove' },
          result: { content, success: true },
        }),
      );

      expect(detectMocks.recordWorktreeExit).toHaveBeenCalledWith({ content, topicId: 't1' });
    });

    it('does NOT clear the worktree when ExitWorktree was refused', async () => {
      // CC refuses to remove a dirty worktree — a validation failure, not an exit.
      await claudeCodeExecutor.onAfterCall!(
        call({
          apiName: 'ExitWorktree',
          params: { action: 'remove' },
          result: { content: 'Worktree has 3 uncommitted files.', success: false },
        }),
      );

      expect(detectMocks.recordWorktreeExit).not.toHaveBeenCalled();
    });

    it('ignores the worktree tools for Codex, which has none', async () => {
      await codexExecutor.onAfterCall!(
        call({
          apiName: 'EnterWorktree',
          identifier: 'codex',
          result: { content: 'Created worktree at /repo/wt. The session is now…', success: true },
        }),
      );

      expect(detectMocks.recordWorktreeEnter).not.toHaveBeenCalled();
    });
  });
});
