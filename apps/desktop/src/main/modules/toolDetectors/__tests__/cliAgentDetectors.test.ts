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
