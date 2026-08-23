import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localSystemExecutor } from './index';

const { globFilesMock, runCommandMock, searchFilesMock } = vi.hoisted(() => ({
  globFilesMock: vi.fn(),
  runCommandMock: vi.fn(),
  searchFilesMock: vi.fn(),
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    globFiles: globFilesMock,
    runCommand: runCommandMock,
    searchLocalFiles: searchFilesMock,
  },
}));

describe('LocalSystemExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('globFiles', () => {
    it('should preserve scope and relative pattern when delegating glob search', async () => {
      globFilesMock.mockResolvedValue({
        files: ['/tmp/images/a.png'],
        success: true,
        total_files: 1,
      });

      await localSystemExecutor.globFiles({
        pattern: '**/*.{png,jpg,jpeg,gif,webp}',
        scope: '/tmp/images',
      });

      expect(globFilesMock).toHaveBeenCalledWith({
        limit: 100,
        pattern: '**/*.{png,jpg,jpeg,gif,webp}',
        scope: '/tmp/images',
      });
    });

    it('returns formatted "Found N files" content on success', async () => {
      globFilesMock.mockResolvedValue({
        engine: 'fast-glob',
        files: ['/Users/me/Downloads/a.pdf', '/Users/me/Downloads/b.pdf'],
        success: true,
        total_files: 2,
      });

      const result = await localSystemExecutor.globFiles({
        pattern: '**/*.pdf',
        scope: '/Users/me/Downloads',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Found 2 files');
      expect(result.state).toEqual({
        files: ['/Users/me/Downloads/a.pdf', '/Users/me/Downloads/b.pdf'],
        pattern: '**/*.pdf',
        totalCount: 2,
      });
    });

    it('falls back to a meaningful content + preserves state when IPC reports failure with no error message', async () => {
      // Defense in depth: even if normalizeResult ever forgets to forward
      // `raw.error`, toResult should still produce a non-empty content
      // ("Tool execution failed") so the Response panel and the LLM never see
      // an empty string. State must also survive into the failure result so
      // any renderer can still draw partial output.
      globFilesMock.mockResolvedValue({
        engine: 'fast-glob',
        files: [],
        success: false,
        total_files: 0,
      });

      const result = await localSystemExecutor.globFiles({
        pattern: '**/*never-matches*',
      });

      expect(result.content).toBeTruthy();
      expect(result.content).not.toBe('');
      expect(result.state).toEqual({
        files: [],
        pattern: '**/*never-matches*',
        totalCount: 0,
      });
    });

    it('surfaces the underlying error in content when the IPC reports failure', async () => {
      // Regression: a fast-glob throw used to come back as
      //   { result: {files:[], totalCount:0}, success: false }
      // with the error stripped. ComputerRuntime.errorOutput then did
      // `JSON.stringify(undefined)` and produced `content: undefined`,
      // which the chat store coerced to "" — leaving Glob tool messages
      // with state set but Response panel blank. Verify we now keep the
      // error message all the way into `content`.
      globFilesMock.mockResolvedValue({
        engine: 'fast-glob',
        error: "EACCES: permission denied, scandir '/System/Volumes/Data'",
        files: [],
        success: false,
        total_files: 0,
      });

      const result = await localSystemExecutor.globFiles({
        pattern: '**/*Financial*Statement*',
      });

      // The failure is reported as one: `success` feeds the tool_end event and
      // `usage.tools.byTool[].errors`, so a permission-denied glob must not
      // count as a successful call.
      expect(result.success).toBe(false);
      expect(result.content).toBeTruthy();
      expect(result.content).toContain('EACCES');
      expect(result.state).toEqual({
        files: [],
        pattern: '**/*Financial*Statement*',
        totalCount: 0,
      });
    });

    it('resolves omitted scope to ctx.workingDirectory', async () => {
      globFilesMock.mockResolvedValue({
        files: [],
        success: true,
        total_files: 0,
      });

      await localSystemExecutor.globFiles(
        { pattern: '**/*.ts' },
        { workingDirectory: '/home/user/project', messageId: 'msg-1' },
      );

      expect(globFilesMock).toHaveBeenCalledWith({
        limit: 100,
        pattern: '**/*.ts',
        scope: '/home/user/project',
      });
    });

    it('resolves scope "." to ctx.workingDirectory', async () => {
      globFilesMock.mockResolvedValue({
        files: [],
        success: true,
        total_files: 0,
      });

      await localSystemExecutor.globFiles(
        { pattern: '**/*.ts', scope: '.' },
        { workingDirectory: '/home/user/project', messageId: 'msg-1' },
      );

      expect(globFilesMock).toHaveBeenCalledWith({
        limit: 100,
        pattern: '**/*.ts',
        scope: '/home/user/project',
      });
    });

    it('preserves explicit absolute scope', async () => {
      globFilesMock.mockResolvedValue({
        files: [],
        success: true,
        total_files: 0,
      });

      await localSystemExecutor.globFiles(
        { pattern: '**/*.ts', scope: '/explicit/path' },
        { workingDirectory: '/home/user/project', messageId: 'msg-1' },
      );

      expect(globFilesMock).toHaveBeenCalledWith({
        limit: 100,
        pattern: '**/*.ts',
        scope: '/explicit/path',
      });
    });
  });

  describe('searchFiles', () => {
    it('resolves omitted scope to ctx.workingDirectory', async () => {
      searchFilesMock.mockResolvedValue([]);

      await localSystemExecutor.searchFiles(
        { keywords: 'test' },
        { workingDirectory: '/home/user/project', messageId: 'msg-1' },
      );

      expect(searchFilesMock).toHaveBeenCalledWith({
        keywords: 'test',
        directory: '/home/user/project',
        limit: 100,
      });
    });

    it('resolves scope "." to ctx.workingDirectory', async () => {
      searchFilesMock.mockResolvedValue([]);

      await localSystemExecutor.searchFiles(
        { keywords: 'test', scope: '.' },
        { workingDirectory: '/home/user/project', messageId: 'msg-1' },
      );

      expect(searchFilesMock).toHaveBeenCalledWith({
        keywords: 'test',
        scope: '.',
        directory: '/home/user/project',
        limit: 100,
      });
    });

    it('preserves explicit absolute scope', async () => {
      searchFilesMock.mockResolvedValue([]);

      await localSystemExecutor.searchFiles(
        { keywords: 'test', scope: '/explicit/path' },
        { workingDirectory: '/home/user/project', messageId: 'msg-1' },
      );

      expect(searchFilesMock).toHaveBeenCalledWith({
        keywords: 'test',
        scope: '/explicit/path',
        directory: '/explicit/path',
        limit: 100,
      });
    });
  });
});

describe('LocalSystemExecutor.runCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runCommandMock.mockResolvedValue({ content: '', success: true });
  });

  it('fences the command and anchors it to the run cwd when the context says so', async () => {
    await localSystemExecutor.runCommand(
      { command: 'git status' },
      { localSandbox: true, messageId: 'm-1', workingDirectory: '/repo' },
    );

    expect(runCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'git status',
        cwd: '/repo',
        sandbox: true,
        sandboxNetwork: false,
      }),
    );
  });

  it('forwards the network allowance for a fenced run', async () => {
    await localSystemExecutor.runCommand(
      { command: 'npm install' },
      {
        localSandbox: true,
        localSandboxNetwork: true,
        messageId: 'm-1',
        workingDirectory: '/repo',
      },
    );

    expect(runCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: true, sandboxNetwork: true }),
    );
  });

  it('leaves an unfenced command without either sandbox field', async () => {
    // The historical path must not shift for agents that never opted in.
    await localSystemExecutor.runCommand(
      { command: 'git status' },
      { messageId: 'm-1', workingDirectory: '/repo' },
    );

    const args = runCommandMock.mock.calls[0][0];
    expect(args).not.toHaveProperty('sandbox');
    expect(args).not.toHaveProperty('sandboxNetwork');
  });

  it('never lets the model pick what it is fenced to', async () => {
    // The runtime drops an args-supplied `cwd` while `trustArgsCwd` is off, and
    // the sandbox roots itself at that same cwd — so a model that guesses the
    // field cannot widen its own fence to an arbitrary directory.
    await localSystemExecutor.runCommand(
      { command: 'git status', cwd: '/etc' },
      { localSandbox: true, messageId: 'm-1', workingDirectory: '/repo' },
    );

    expect(runCommandMock).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo' }));
  });
});
