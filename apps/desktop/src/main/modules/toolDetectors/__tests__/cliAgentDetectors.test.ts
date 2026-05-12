import * as childProcess from 'node:child_process';
import * as os from 'node:os';

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

describe('cliAgentDetectors', () => {
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

      const { claudeCodeDetector } = await import('../cliAgentDetectors');
      const status = await claudeCodeDetector.detect();

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

      const { claudeCodeDetector } = await import('../cliAgentDetectors');
      const status = await claudeCodeDetector.detect();

      expect(status.available).toBe(false);
      // We should NOT proceed to invoke anything after a failed resolve.
      expect(execMock).not.toHaveBeenCalled();
    });

    it('rejects custom commands containing shell metacharacters', async () => {
      const { detectHeterogeneousCliCommand } = await import('../cliAgentDetectors');
      const status = await detectHeterogeneousCliCommand('claude-code', 'claude & calc.exe');

      expect(status.available).toBe(false);
      expect(execFileMock).not.toHaveBeenCalled();
      expect(execMock).not.toHaveBeenCalled();
    });

    it('fails detection when version output does not match the expected keyword', async () => {
      callExecFile('C:\\some\\other\\claude.cmd\r\n');
      callExec('this is some other binary v1.0');

      const { claudeCodeDetector } = await import('../cliAgentDetectors');
      const status = await claudeCodeDetector.detect();

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

      const { codexDetector } = await import('../cliAgentDetectors');
      const status = await codexDetector.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe('C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex.cmd');
      expect(execMock.mock.calls[0]![0]).toBe(
        '"C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex.cmd" --version',
      );
    });

    it('prefers .exe over .cmd when both are present', async () => {
      callExecFile(['C:\\tools\\foo.exe', 'C:\\tools\\foo.cmd'].join('\r\n'));
      callExecFile('claude code 1.0.0');

      const { claudeCodeDetector } = await import('../cliAgentDetectors');
      const status = await claudeCodeDetector.detect();

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

      const { claudeCodeDetector } = await import('../cliAgentDetectors');
      const status = await claudeCodeDetector.detect();

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

      const { claudeCodeDetector } = await import('../cliAgentDetectors');
      const status = await claudeCodeDetector.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe('/usr/local/bin/claude');
      expect(execMock).not.toHaveBeenCalled();
      expect(execFileMock).toHaveBeenCalledTimes(2);
    });
  });
});
