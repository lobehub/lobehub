import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeCodeExecutor, codexExecutor } from '../heteroCli';

const detectMocks = vi.hoisted(() => ({ recordGitCommandEffects: vi.fn() }));

vi.mock('../worktreeDetection', () => ({
  recordGitCommandEffects: detectMocks.recordGitCommandEffects,
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
    // Empty apiEnum → never treated as an invokable client tool.
    expect(claudeCodeExecutor.hasApi('Bash')).toBe(false);
    expect(claudeCodeExecutor.getApiNames()).toEqual([]);
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
});
