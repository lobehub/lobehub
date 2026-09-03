import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localSystemExecutorWithGitEffects } from '../localSystem';

const detectMocks = vi.hoisted(() => ({
  recordGitCommandEffects: vi.fn(),
}));

vi.mock('../worktreeDetection', () => ({
  recordGitCommandEffects: detectMocks.recordGitCommandEffects,
}));

const localSystemMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@lobechat/builtin-tool-local-system/client/executor', () => ({
  localSystemExecutor: {
    getApiNames: () => [
      'editFile',
      'getCommandOutput',
      'globFiles',
      'grepContent',
      'killCommand',
      'listFiles',
      'moveFiles',
      'readFile',
      'readFiles',
      'runCommand',
      'searchFiles',
      'writeFile',
    ],
    hasApi: (apiName: string) =>
      [
        'editFile',
        'getCommandOutput',
        'globFiles',
        'grepContent',
        'killCommand',
        'listFiles',
        'moveFiles',
        'readFile',
        'readFiles',
        'runCommand',
        'searchFiles',
        'writeFile',
      ].includes(apiName),
    identifier: 'local-system',
    invoke: localSystemMocks.invoke,
  },
}));

const call = (over: Record<string, any> = {}) => ({
  apiName: 'runCommand',
  identifier: 'local-system',
  params: { command: 'git worktree add /wt' },
  result: { content: '', success: true },
  topicId: 't1',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('localSystemExecutorWithGitEffects', () => {
  it('delegates invocation and API introspection to the package executor', async () => {
    expect(localSystemExecutorWithGitEffects.identifier).toBe('local-system');
    expect(localSystemExecutorWithGitEffects.hasApi('runCommand')).toBe(true);
    expect(localSystemExecutorWithGitEffects.hasApi('nope')).toBe(false);
    expect(localSystemExecutorWithGitEffects.getApiNames()).toContain('runCommand');

    const result = { content: 'ok', success: true };
    localSystemMocks.invoke.mockResolvedValue(result);
    await expect(
      localSystemExecutorWithGitEffects.invoke('runCommand', { command: 'ls' }, {
        messageId: 'm1',
      } as any),
    ).resolves.toBe(result);
    expect(localSystemMocks.invoke).toHaveBeenCalledWith('runCommand', { command: 'ls' }, {
      messageId: 'm1',
    } as any);
  });

  it('records the worktree for a successful runCommand, keyed by the run topic', async () => {
    await localSystemExecutorWithGitEffects.onAfterCall!(call());
    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'git worktree add /wt',
      resultContent: '',
      topicId: 't1',
    });
  });

  it('passes shell output through so `gh pr create` and push refs are detectable', async () => {
    await localSystemExecutorWithGitEffects.onAfterCall!(
      call({
        params: { command: 'gh pr create --title "fix thing"' },
        result: {
          content: 'https://github.com/lobehub/lobehub/pull/19082',
          success: true,
        },
      }),
    );

    expect(detectMocks.recordGitCommandEffects).toHaveBeenCalledWith({
      command: 'gh pr create --title "fix thing"',
      resultContent: 'https://github.com/lobehub/lobehub/pull/19082',
      topicId: 't1',
    });
  });

  it('skips a failed command — it made no git side effect', async () => {
    await localSystemExecutorWithGitEffects.onAfterCall!(
      call({ result: { content: 'fatal: not a git repository', success: false } }),
    );
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  it('skips when the run has no topic', async () => {
    await localSystemExecutorWithGitEffects.onAfterCall!(call({ topicId: undefined }));
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  it('is constrained to runCommand — ignores the file tools', async () => {
    // A file tool whose params happen to carry a `command`-shaped field.
    await localSystemExecutorWithGitEffects.onAfterCall!(
      call({ apiName: 'writeFile', params: { command: 'git worktree add /wt' } }),
    );
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  it('reads only command/cmd, never content', async () => {
    await localSystemExecutorWithGitEffects.onAfterCall!(
      call({ params: { content: 'git worktree add /wt' } }),
    );
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  it('skips when params carry no command at all', async () => {
    await localSystemExecutorWithGitEffects.onAfterCall!(call({ params: {} }));
    expect(detectMocks.recordGitCommandEffects).not.toHaveBeenCalled();
  });

  it('propagates nothing when recordGitCommandEffects throws — hooks are fire-and-forget upstream', async () => {
    detectMocks.recordGitCommandEffects.mockRejectedValueOnce(new Error('store gone'));
    await expect(localSystemExecutorWithGitEffects.onAfterCall!(call())).rejects.toThrow(
      'store gone',
    );
  });
});
