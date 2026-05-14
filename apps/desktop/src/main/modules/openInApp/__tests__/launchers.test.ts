import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';

import { shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { launchApp } from '../launchers';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(),
  },
}));

const mockedAccess = vi.mocked(access);
const mockedExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
const mockedShell = vi.mocked(shell);

type LastCall = { file: string; args: string[] };

const captureExec = (): LastCall => {
  expect(mockedExecFile).toHaveBeenCalled();
  const [file, args] = mockedExecFile.mock.calls[0];
  return { args: args as string[], file: file as string };
};

interface ExecOutcome {
  code: number;
  stderr?: string;
  stdout?: string;
}

const respondExec = (outcome: ExecOutcome) => {
  mockedExecFile.mockImplementationOnce(
    (_file: string, _args: string[], _opts: unknown, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (outcome.code === 0) {
        callback(null, outcome.stdout ?? '', outcome.stderr ?? '');
      } else {
        const err: NodeJS.ErrnoException & { stderr?: string } = new Error('exec failed');
        err.stderr = outcome.stderr ?? '';
        (err as any).code = outcome.code;
        callback(err, '', outcome.stderr ?? '');
      }
      return undefined as any;
    },
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedAccess.mockResolvedValue(undefined);
});

describe('launchApp - path validation', () => {
  it('rejects relative paths', async () => {
    const result = await launchApp('vscode', 'relative/path', 'darwin');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Path must be absolute');
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('rejects paths that do not exist', async () => {
    mockedAccess.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await launchApp('vscode', '/missing', 'darwin');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Path not found: /missing');
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('returns error when app is not available on platform', async () => {
    const result = await launchApp('xcode', '/some/path', 'linux');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Xcode');
    expect(result.error).toContain('not available on this platform');
  });
});

describe('launchApp - macOpenA strategy', () => {
  it('spawns open -a <appName> <path>', async () => {
    respondExec({ code: 0 });

    const result = await launchApp('vscode', '/work/dir', 'darwin');

    expect(result.success).toBe(true);
    const call = captureExec();
    expect(call.file).toBe('open');
    expect(call.args).toEqual(['-a', 'Visual Studio Code', '/work/dir']);
  });

  it('returns stderr substring on failure', async () => {
    respondExec({ code: 1, stderr: '  cannot open Cursor.app  ' });

    const result = await launchApp('cursor', '/work/dir', 'darwin');

    expect(result.success).toBe(false);
    expect(result.error).toBe('cannot open Cursor.app');
  });
});

describe('launchApp - macOpen strategy', () => {
  it('spawns open <path>', async () => {
    respondExec({ code: 0 });

    const result = await launchApp('finder', '/work/dir', 'darwin');

    expect(result.success).toBe(true);
    const call = captureExec();
    expect(call.file).toBe('open');
    expect(call.args).toEqual(['/work/dir']);
  });
});

describe('launchApp - exec strategy', () => {
  it('spawns <binary> <path>', async () => {
    respondExec({ code: 0 });

    const result = await launchApp('vscode', '/work/dir', 'linux');

    expect(result.success).toBe(true);
    const call = captureExec();
    expect(call.file).toBe('code');
    expect(call.args).toEqual(['/work/dir']);
  });

  it('appends registry-provided args before path', async () => {
    const registry = await import('../registry');
    const original = registry.APP_REGISTRY.vscode.launch.linux;
    registry.APP_REGISTRY.vscode.launch.linux = {
      args: ['--new-window'],
      binary: 'code',
      type: 'exec',
    };

    respondExec({ code: 0 });

    const result = await launchApp('vscode', '/work/dir', 'linux');

    expect(result.success).toBe(true);
    const call = captureExec();
    expect(call.args).toEqual(['--new-window', '/work/dir']);

    registry.APP_REGISTRY.vscode.launch.linux = original;
  });

  it('rejects suspicious binary names', async () => {
    const registry = await import('../registry');
    const original = registry.APP_REGISTRY.vscode.launch.linux;
    registry.APP_REGISTRY.vscode.launch.linux = {
      binary: 'rm; ls',
      type: 'exec',
    };

    const result = await launchApp('vscode', '/work/dir', 'linux');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid binary name');
    expect(mockedExecFile).not.toHaveBeenCalled();

    registry.APP_REGISTRY.vscode.launch.linux = original;
  });

  it('rejects binary names with spaces', async () => {
    const registry = await import('../registry');
    const original = registry.APP_REGISTRY.vscode.launch.linux;
    registry.APP_REGISTRY.vscode.launch.linux = {
      binary: 'foo bar',
      type: 'exec',
    };

    const result = await launchApp('vscode', '/work/dir', 'linux');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid binary name');

    registry.APP_REGISTRY.vscode.launch.linux = original;
  });

  it('accepts absolute-path binary names', async () => {
    const registry = await import('../registry');
    const original = registry.APP_REGISTRY.vscode.launch.linux;
    registry.APP_REGISTRY.vscode.launch.linux = {
      binary: '/usr/local/bin/code',
      type: 'exec',
    };

    respondExec({ code: 0 });

    const result = await launchApp('vscode', '/work/dir', 'linux');

    expect(result.success).toBe(true);
    const call = captureExec();
    expect(call.file).toBe('/usr/local/bin/code');

    registry.APP_REGISTRY.vscode.launch.linux = original;
  });

  it('returns stderr substring on non-zero exit', async () => {
    respondExec({ code: 1, stderr: 'command not found' });

    const result = await launchApp('vscode', '/work/dir', 'linux');

    expect(result.success).toBe(false);
    expect(result.error).toBe('command not found');
  });
});

describe('launchApp - shellOpenPath strategy', () => {
  it('delegates to shell.openPath', async () => {
    mockedShell.openPath.mockResolvedValueOnce('');

    const result = await launchApp('explorer', '/abs/work-dir', 'win32');

    expect(result.success).toBe(true);
    expect(mockedShell.openPath).toHaveBeenCalledWith('/abs/work-dir');
  });

  it('returns error string from shell.openPath as error', async () => {
    mockedShell.openPath.mockResolvedValueOnce('cannot open');

    const result = await launchApp('files', '/some/dir', 'linux');

    expect(result.success).toBe(false);
    expect(result.error).toBe('cannot open');
  });
});
