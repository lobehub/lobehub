import * as childProcess from 'node:child_process';
import * as os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be set up before importing the module under test, because the
// module captures `promisify(execFile)` / `promisify(exec)` at import time.
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

describe('cliAgentBinaries', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('on Windows with an npm-installed `claude.cmd` shim', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('win32');
    });

    it('resolves `claude` to the .cmd path via `where`, then runs it through the shell', async () => {
      // 1) `where claude` → resolves to the .cmd shim under %APPDATA%\npm
      callExecFile('C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude.cmd\r\n');
      // 2) `cmd /c "...\\claude.cmd" --version` → keyword match
      callExec('1.2.3 (Claude Code)');

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe('C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude.cmd');
      expect(status.version).toBe('1.2.3 (Claude Code)');

      // The validation call must go via `exec` (shell), NOT `execFile`, so
      // cmd.exe can actually interpret the .cmd shim.
      expect(execMock).toHaveBeenCalledTimes(1);
      const execCall = execMock.mock.calls[0]!;
      expect(execCall[0]).toBe('"C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude.cmd" --version');
    });

    it('returns unavailable when `where` finds nothing', async () => {
      callExecFileError(new Error('not found'));

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(false);
      // We should NOT proceed to invoke anything after a failed resolve.
      expect(execMock).not.toHaveBeenCalled();
    });

    it('rejects custom commands containing shell metacharacters', async () => {
      const { detectHeterogeneousCliCommand } = await import('../cliAgentBinaries');
      const status = await detectHeterogeneousCliCommand('claude-code', 'claude & calc.exe');

      expect(status.available).toBe(false);
      expect(execFileMock).not.toHaveBeenCalled();
      expect(execMock).not.toHaveBeenCalled();
    });

    it('fails detection when version output does not match the expected keyword', async () => {
      callExecFile('C:\\some\\other\\claude.cmd\r\n');
      callExec('this is some other binary v1.0');

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(false);
    });

    it('prefers a .cmd shim when `where` returns multiple PATHEXT matches (codex case)', async () => {
      // npm drops a Unix shell-script wrapper (extensionless) alongside the
      // Windows `.cmd` / `.ps1` shims. `where` lists every PATHEXT match;
      // taking the first line would land us on the unrunnable wrapper.
      callExecFile(
        [
          'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex',
          'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex.cmd',
          'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex.ps1',
        ].join('\r\n'),
      );
      callExec('codex 0.130.0');

      const { codexBinary } = await import('../cliAgentBinaries');
      const status = await codexBinary.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe('C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex.cmd');
      expect(execMock.mock.calls[0]![0]).toBe(
        '"C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex.cmd" --version',
      );
    });

    it('prefers .exe over .cmd when both are present', async () => {
      callExecFile(['C:\\tools\\foo.exe', 'C:\\tools\\foo.cmd'].join('\r\n'));
      callExecFile('claude code 1.0.0');

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe('C:\\tools\\foo.exe');
      // .exe runs directly via execFile — no shell.
      expect(execMock).not.toHaveBeenCalled();
      expect(execFileMock).toHaveBeenCalledTimes(2);
      expect(execFileMock.mock.calls[1]![0]).toBe('C:\\tools\\foo.exe');
    });

    it('reports unavailable when `where` only returns unrunnable matches (.ps1 / extensionless)', async () => {
      callExecFile(
        [
          'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude',
          'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude.ps1',
        ].join('\r\n'),
      );

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(false);
      // Must not attempt to invoke the unrunnable matches.
      expect(execMock).not.toHaveBeenCalled();
      expect(execFileMock).toHaveBeenCalledTimes(1); // just `where`
    });
  });

  describe('on macOS / Linux with a Unix-style claude binary', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('darwin');
    });

    it('runs the binary directly via execFile (no shell)', async () => {
      callExecFile('/usr/local/bin/claude\n');
      callExecFile('1.2.3 (Claude Code)');

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe('/usr/local/bin/claude');
      expect(execMock).not.toHaveBeenCalled();
      expect(execFileMock).toHaveBeenCalledTimes(2);
      // Resolved on the inherited PATH — nothing extra to carry into spawn.
      expect(status.resolvedPathEnv).toBeUndefined();
    });

    it('falls back to the Codex.app bundled CLI when `codex` is not on any PATH', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      // Deterministic env: no SHELL → no login-shell lookup, merged PATH
      // equals process.env.PATH → no second `which` attempt.
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which codex
        callExecFile('codex-cli 0.138.0'); // bundled CLI --version

        const { codexBinary } = await import('../cliAgentBinaries');
        const status = await codexBinary.detect();

        expect(status.available).toBe(true);
        expect(status.path).toBe('/Applications/Codex.app/Contents/Resources/codex');
        expect(status.version).toBe('codex-cli 0.138.0');

        expect(execFileMock).toHaveBeenCalledTimes(2);
        expect(execFileMock.mock.calls[0]![0]).toBe('which');
        expect(execFileMock.mock.calls[1]![0]).toBe(
          '/Applications/Codex.app/Contents/Resources/codex',
        );
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('stays unavailable when neither PATH nor the well-known locations have codex', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which codex
        callExecFileError(new Error('ENOENT')); // /Applications candidate
        callExecFileError(new Error('ENOENT')); // ~/Applications candidate

        const { codexBinary } = await import('../cliAgentBinaries');
        const status = await codexBinary.detect();

        expect(status.available).toBe(false);
        expect(execFileMock).toHaveBeenCalledTimes(3);
        expect(execFileMock.mock.calls[2]![0]).toBe(
          path.join(os.homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
        );
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('does not probe well-known locations for an explicit path-like command', async () => {
      callExecFileError(new Error('ENOENT')); // /custom/bin/codex --version

      const { detectHeterogeneousCliCommand } = await import('../cliAgentBinaries');
      const status = await detectHeterogeneousCliCommand('codex', '/custom/bin/codex');

      expect(status.available).toBe(false);
      // Only the explicit path's --version attempt — no fallback probing.
      expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to the login shell PATH for tools installed by shell setup', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';

      try {
        callExecFileError(new Error('not found'));
        callExecFile('/opt/homebrew/bin:/Users/Hanam/.local/share/mise/shims:/usr/bin:/bin');
        callExecFile('/Users/Hanam/.local/share/mise/shims/gemini\n');
        callExecFile('gemini 0.2.0');

        const { geminiCliBinary } = await import('../cliAgentBinaries');
        const status = await geminiCliBinary.detect();

        expect(status.available).toBe(true);
        expect(status.path).toBe('/Users/Hanam/.local/share/mise/shims/gemini');
        expect(status.version).toBe('gemini 0.2.0');
        // The login-shell PATH that resolved the shim must be surfaced so the
        // spawn site can carry it into the child env (mise/nvm `node` lives
        // there, not on the leaner inherited PATH).
        expect(status.resolvedPathEnv).toBe(
          '/opt/homebrew/bin:/Users/Hanam/.local/share/mise/shims:/usr/bin:/bin',
        );

        expect(execFileMock).toHaveBeenCalledTimes(4);
        expect(execFileMock.mock.calls[0]![0]).toBe('which');
        expect(execFileMock.mock.calls[1]![0]).toBe('/bin/zsh');
        expect(execFileMock.mock.calls[1]![1]).toEqual(['-ilc', 'printf "%s" "$PATH"']);
        expect(execFileMock.mock.calls[2]![0]).toBe('which');
        expect(execFileMock.mock.calls[2]![2]).toMatchObject({
          env: {
            PATH: '/opt/homebrew/bin:/Users/Hanam/.local/share/mise/shims:/usr/bin:/bin',
          },
        });
        expect(execFileMock.mock.calls[3]![0]).toBe('/Users/Hanam/.local/share/mise/shims/gemini');
        expect(execFileMock.mock.calls[3]![2]).toMatchObject({
          env: {
            PATH: '/opt/homebrew/bin:/Users/Hanam/.local/share/mise/shims:/usr/bin:/bin',
          },
        });
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });
  });
});
