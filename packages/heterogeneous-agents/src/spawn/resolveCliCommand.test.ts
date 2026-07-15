import * as childProcess from 'node:child_process';
import * as os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be set up before importing the module under test, because it
// captures `promisify(execFile)` / `promisify(exec)` at import time.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => actual.platform()) };
});

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

const platformMock = vi.mocked(os.platform);
const execFileMock = vi.mocked(childProcess.execFile);
const execMock = vi.mocked(childProcess.exec);

const noErr = null;
const callExecFile = (stdout: string, stderr = '') => {
  execFileMock.mockImplementationOnce(((file: string, args: any, opts: any, cb: any) => {
    // promisify-wrapped: the callback is always the last positional arg.
    const callback = typeof opts === 'function' ? opts : cb;
    callback(noErr, { stdout, stderr });
    return {} as any;
  }) as any);
};
const callExecFileError = (err: Error) => {
  execFileMock.mockImplementationOnce(((file: string, args: any, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    callback(err, { stdout: '', stderr: '' });
    return {} as any;
  }) as any);
};
const callExec = (stdout: string, stderr = '') => {
  execMock.mockImplementationOnce(((cmd: string, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    callback(noErr, { stdout, stderr });
    return {} as any;
  }) as any);
};

const importModule = () => import('./resolveCliCommand');

describe('resolveCliCommand', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('detectHeterogeneousCliCommand — macOS / Linux', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('darwin');
    });

    it('resolves AMP on PATH and validates its help banner', async () => {
      callExecFile('/Users/x/.local/bin/amp\n');
      callExecFile('Amp CLI\n\nUsage: amp [options] [command]');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('amp', 'amp');

      expect(status).toMatchObject({
        available: true,
        path: '/Users/x/.local/bin/amp',
        version: 'Amp CLI',
      });
      expect(execFileMock.mock.calls[1]![1]).toEqual(['--help']);
    });

    it('resolves `codex` on PATH and validates it via execFile (no shell)', async () => {
      callExecFile('/usr/local/bin/codex\n');
      callExecFile('codex-cli 0.142.5');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('codex', 'codex');

      expect(status.available).toBe(true);
      expect(status.path).toBe('/usr/local/bin/codex');
      expect(status.version).toBe('codex-cli 0.142.5');
      expect(status.resolvedPathEnv).toBeUndefined();
      expect(execMock).not.toHaveBeenCalled();
    });

    it('falls through a PATH `codex` that fails validation to the ChatGPT.app bundled CLI', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      // Deterministic env: no SHELL → no login-shell lookup.
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        // `which codex` finds the (broken) global shim...
        callExecFile('/Users/x/Library/pnpm/codex\n');
        // ...but its `--version` errors (ENOENT-style broken wrapper).
        callExecFileError(new Error('spawn ENOENT'));
        // Fallback: the ChatGPT.app bundled CLI validates.
        callExecFile('codex-cli 0.142.5');

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('codex', 'codex');

        expect(status.available).toBe(true);
        expect(status.path).toBe('/Applications/ChatGPT.app/Contents/Resources/codex');
        expect(execFileMock.mock.calls[2]![0]).toBe(
          '/Applications/ChatGPT.app/Contents/Resources/codex',
        );
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('falls back to the legacy Codex.app bundle when ChatGPT.app is unavailable', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which codex
        callExecFileError(new Error('ENOENT')); // /Applications/ChatGPT.app
        callExecFileError(new Error('ENOENT')); // ~/Applications/ChatGPT.app
        callExecFile('codex-cli 0.142.5'); // /Applications/Codex.app

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('codex', 'codex');

        expect(status.available).toBe(true);
        expect(status.path).toBe('/Applications/Codex.app/Contents/Resources/codex');
        expect(execFileMock.mock.calls[3]![0]).toBe(
          '/Applications/Codex.app/Contents/Resources/codex',
        );
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('does NOT probe well-known locations for a custom command', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which codex-beta

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('codex', 'codex-beta');

        expect(status.available).toBe(false);
        // Only the custom command's own `which` runs — no app-bundle fallback.
        expect(execFileMock).toHaveBeenCalledTimes(1);
        expect(execFileMock.mock.calls[0]![0]).toBe('which');
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('falls back to the login-shell PATH for a shim installed by shell setup', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';

      try {
        callExecFileError(new Error('not found')); // which codex (inherited PATH)
        callExecFile('/opt/homebrew/bin:/Users/x/.local/share/mise/shims:/usr/bin:/bin'); // login shell PATH
        callExecFile('/Users/x/.local/share/mise/shims/codex\n'); // which codex (login PATH)
        callExecFile('codex-cli 0.142.5');

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('codex', 'codex');

        expect(status.available).toBe(true);
        expect(status.path).toBe('/Users/x/.local/share/mise/shims/codex');
        expect(status.resolvedPathEnv).toBe(
          '/opt/homebrew/bin:/Users/x/.local/share/mise/shims:/usr/bin:/bin',
        );
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });
  });

  describe('detectValidatedCommand — Windows npm shims', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('win32');
    });

    it('resolves `codex` to the .cmd shim via `where`, then runs it through the shell', async () => {
      callExecFile('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd\r\n');
      callExec('codex 0.142.5');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('codex', { validateKeywords: ['codex'] });

      expect(status.available).toBe(true);
      expect(status.path).toBe('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd');
      expect(execMock.mock.calls[0]![0]).toBe(
        '"C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd" --version',
      );
    });

    it('prefers the .cmd shim when `where` returns multiple PATHEXT matches', async () => {
      callExecFile(
        [
          'C:\\Users\\x\\AppData\\Roaming\\npm\\codex',
          'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd',
          'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.ps1',
        ].join('\r\n'),
      );
      callExec('codex 0.142.5');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('codex', { validateKeywords: ['codex'] });

      expect(status.available).toBe(true);
      expect(status.path).toBe('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd');
    });

    it('rejects a command containing shell metacharacters', async () => {
      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('codex & calc.exe', {
        validateKeywords: ['codex'],
      });

      expect(status.available).toBe(false);
      expect(execFileMock).not.toHaveBeenCalled();
      expect(execMock).not.toHaveBeenCalled();
    });
  });

  describe('resolveHeteroSpawnCommand', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('darwin');
    });

    it('uses amp as the default command for the AMP adapter', async () => {
      callExecFile('/Users/x/.local/bin/amp\n');
      callExecFile('Amp CLI');

      const { resolveHeteroSpawnCommand } = await importModule();
      const resolved = await resolveHeteroSpawnCommand('amp', undefined);

      expect(resolved.command).toBe('/Users/x/.local/bin/amp');
    });

    it('resolves the default bare command to the validated absolute path', async () => {
      callExecFile('/usr/local/bin/codex\n');
      callExecFile('codex-cli 0.142.5');

      const { resolveHeteroSpawnCommand } = await importModule();
      const resolved = await resolveHeteroSpawnCommand('codex', undefined);

      expect(resolved.command).toBe('/usr/local/bin/codex');
      expect(resolved.pathEnv).toBeUndefined();
    });

    it('surfaces the login-shell PATH as pathEnv when resolution used it', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';

      try {
        callExecFileError(new Error('not found'));
        callExecFile('/opt/homebrew/bin:/usr/bin:/bin');
        callExecFile('/opt/homebrew/bin/codex\n');
        callExecFile('codex-cli 0.142.5');

        const { resolveHeteroSpawnCommand } = await importModule();
        const resolved = await resolveHeteroSpawnCommand('codex', 'codex');

        expect(resolved.command).toBe('/opt/homebrew/bin/codex');
        expect(resolved.pathEnv).toBe('/opt/homebrew/bin:/usr/bin:/bin');
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });

    it('falls back to the bare default command when nothing validates', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      // Clean PATH (no dupes/empties) so the merged login-shell PATH equals it
      // → no second `which` attempt; and no SHELL → no login-shell lookup.
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which codex
        callExecFileError(new Error('ENOENT')); // /Applications/ChatGPT.app
        callExecFileError(new Error('ENOENT')); // ~/Applications/ChatGPT.app
        callExecFileError(new Error('ENOENT')); // /Applications/Codex.app
        callExecFileError(new Error('ENOENT')); // ~/Applications/Codex.app

        const { resolveHeteroSpawnCommand } = await importModule();
        const resolved = await resolveHeteroSpawnCommand('codex', 'codex');

        expect(resolved.command).toBe('codex');
        expect(resolved.pathEnv).toBeUndefined();
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('uses a custom command verbatim without any resolution attempt', async () => {
      const { resolveHeteroSpawnCommand } = await importModule();
      const resolved = await resolveHeteroSpawnCommand(
        'claude-code',
        '/usr/local/bin/claude-wrapped',
      );

      expect(resolved.command).toBe('/usr/local/bin/claude-wrapped');
      expect(resolved.pathEnv).toBeUndefined();
      // Custom command = no probing at all.
      expect(execFileMock).not.toHaveBeenCalled();
      expect(execMock).not.toHaveBeenCalled();
    });

    it('never throws — a resolver failure degrades to the bare command', async () => {
      // execFile throws synchronously (not just callback error).
      execFileMock.mockImplementation((() => {
        throw new Error('boom');
      }) as any);

      const { resolveHeteroSpawnCommand } = await importModule();
      const resolved = await resolveHeteroSpawnCommand('codex', 'codex');

      expect(resolved.command).toBe('codex');
    });
  });

  it('reports unavailable for an unknown agent type', async () => {
    const { detectHeterogeneousCliCommand } = await importModule();
    const status = await detectHeterogeneousCliCommand('gemini' as any, 'gemini');
    expect(status.available).toBe(false);
    // Sanity: keep `path` unused-import-free.
    expect(path.sep).toBeTruthy();
  });
});
