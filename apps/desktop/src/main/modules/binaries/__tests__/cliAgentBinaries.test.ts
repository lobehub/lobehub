import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
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

// Resolving a Windows `.cmd` shim to its real target reads the shim off disk.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');
  return { ...actual, access: vi.fn(), readFile: vi.fn() };
});

const platformMock = vi.mocked(os.platform);
const execFileMock = vi.mocked(childProcess.execFile);
const execMock = vi.mocked(childProcess.exec);
const accessMock = vi.mocked(fsPromises.access);
const readFileMock = vi.mocked(fsPromises.readFile);

/** Files present on the fake host: contents for shims, `true` for binaries. */
const existingFiles = (files: Record<string, string | true>) => {
  const entries = new Map(
    Object.entries(files).map(([filePath, content]) => [filePath.toLowerCase(), content]),
  );

  accessMock.mockImplementation(async (filePath) => {
    if (!entries.has(String(filePath).toLowerCase())) throw new Error(`missing: ${filePath}`);
  });
  readFileMock.mockImplementation((async (filePath: string) => {
    const content = entries.get(String(filePath).toLowerCase());
    if (typeof content !== 'string') throw new Error(`unreadable: ${filePath}`);
    return content;
  }) as never);
};

/** A stock npm shim — the shape the resolver knows how to unwrap. */
const npmShim = (packagePath: string) =>
  `@ECHO off\r\n"%dp0%\\node.exe"  "%dp0%\\${packagePath}" %*\r\n`;

const noErr = null;
const DROID_ACP_HELP = `Usage: droid exec [options]
  --output-format <format>  Output format (ACP modes)`;
const TRAE_ACP_HELP = `Start the ACP server
Usage: trae-cli acp serve [flags]
  -y, --yolo   Enable YOLO mode`;
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

/**
 * Fail any call a test did not queue. Without this the promisified `execFile`
 * never settles and the test dies on a 5s timeout that says nothing about
 * which extra process was spawned.
 */
const rejectUnqueuedExecFile = () => {
  execFileMock.mockImplementation(((file: string, args: any, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    callback(new Error(`unexpected execFile: ${file} ${JSON.stringify(args)}`), {
      stderr: '',
      stdout: '',
    });
    return {} as any;
  }) as any);
};

describe('cliAgentBinaries', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execMock.mockReset();
    accessMock.mockReset();
    readFileMock.mockReset();
    rejectUnqueuedExecFile();
    existingFiles({});
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('on Windows with an npm-installed `claude.cmd` shim', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('win32');
    });

    it('resolves `claude` to the .cmd path via `where` without constructing a shell command', async () => {
      const npmDir = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm';
      const scriptPath = `${npmDir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
      existingFiles({
        [`${npmDir}\\claude.cmd`]: npmShim('node_modules\\@anthropic-ai\\claude-code\\cli.js'),
        [`${npmDir}\\node.exe`]: true,
        [scriptPath]: true,
      });
      // 1) `where claude` → resolves to the .cmd shim under %APPDATA%\npm
      callExecFile(`${npmDir}\\claude.cmd\r\n`);
      // 2) validate the resolved command without interpolating it into a shell string
      callExecFile('1.2.3 (Claude Code)');

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe(`${npmDir}\\claude.cmd`);
      expect(status.version).toBe('1.2.3');

      expect(execMock).not.toHaveBeenCalled();
      expect(execFileMock).toHaveBeenCalledTimes(2);
      // The shim is unwrapped into node + script rather than handed to a shell.
      expect(execFileMock.mock.calls[1]![0]).toBe(`${npmDir}\\node.exe`);
      expect(execFileMock.mock.calls[1]![1]).toEqual([scriptPath, '--version']);
    });

    it('returns unavailable when `where` finds nothing', async () => {
      const originalPath = process.env.PATH;
      // Single clean segment: the recovered PATH then equals it exactly, so no
      // second `where` attempt runs.
      process.env.PATH = 'C:\\Windows';

      try {
        callExecFileError(new Error('not found')); // where claude
        // A failed `where` falls back to the registry PATH, in case this
        // process is holding an environment snapshot older than the install.
        callExecFileError(new Error('access denied')); // reg query HKLM
        callExecFileError(new Error('access denied')); // reg query HKCU

        const { claudeCodeBinary } = await import('../cliAgentBinaries');
        const status = await claudeCodeBinary.detect();

        expect(status.available).toBe(false);
        // We should NOT proceed to invoke anything after a failed resolve.
        expect(execMock).not.toHaveBeenCalled();
        expect(execFileMock).toHaveBeenCalledTimes(3);
      } finally {
        process.env.PATH = originalPath;
      }
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
      callExecFile('this is some other binary v1.0');

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(false);
    });

    it('prefers a .cmd shim when `where` returns multiple PATHEXT matches (codex case)', async () => {
      // npm drops a Unix shell-script wrapper (extensionless) alongside the
      // Windows `.cmd` / `.ps1` shims. `where` lists every PATHEXT match;
      // taking the first line would land us on the unrunnable wrapper.
      const npmDir = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm';
      const scriptPath = `${npmDir}\\node_modules\\@openai\\codex\\bin\\codex.js`;
      existingFiles({
        [`${npmDir}\\codex.cmd`]: npmShim('node_modules\\@openai\\codex\\bin\\codex.js'),
        [`${npmDir}\\node.exe`]: true,
        [scriptPath]: true,
      });
      callExecFile(
        [`${npmDir}\\codex`, `${npmDir}\\codex.cmd`, `${npmDir}\\codex.ps1`].join('\r\n'),
      );
      callExecFile('codex 0.130.0');

      const { codexBinary } = await import('../cliAgentBinaries');
      const status = await codexBinary.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe(`${npmDir}\\codex.cmd`);
      expect(execMock).not.toHaveBeenCalled();
      expect(execFileMock.mock.calls[1]![0]).toBe(`${npmDir}\\node.exe`);
      expect(execFileMock.mock.calls[1]![1]).toEqual([scriptPath, '--version']);
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

    it('preserves PATH order when npm .cmd precedes a later .exe (Vite+ case)', async () => {
      const npmDir = 'C:\\Users\\hp\\AppData\\Roaming\\npm';
      const scriptPath = `${npmDir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
      existingFiles({
        [`${npmDir}\\claude.cmd`]: npmShim('node_modules\\@anthropic-ai\\claude-code\\cli.js'),
        [`${npmDir}\\node.exe`]: true,
        [scriptPath]: true,
      });
      callExecFile(
        [`${npmDir}\\claude.cmd`, 'C:\\Users\\hp\\.vite-plus\\bin\\claude.exe'].join('\r\n'),
      );
      callExecFile('1.2.3 (Claude Code)');

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe(`${npmDir}\\claude.cmd`);
      expect(execMock).not.toHaveBeenCalled();
      expect(execFileMock.mock.calls[1]![0]).toBe(`${npmDir}\\node.exe`);
      expect(execFileMock.mock.calls[1]![1]).toEqual([scriptPath, '--version']);
    });

    it('skips a shim it cannot unwrap and validates the next candidate instead', async () => {
      // A third-party wrapper that replaced the npm shim forwards through its
      // own variable, so no shim pattern matches. `execFile` cannot spawn a
      // .cmd directly (EINVAL since the CVE-2024-27980 fix), so the only way
      // to stay useful is to move on to the next entry `where` reported.
      const hijackedShim = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex.cmd';
      const nativeExe = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe';
      existingFiles({
        [hijackedShim]: '@echo off\r\n"%OCX_REAL_CODEX%" %*\r\n',
        [nativeExe]: true,
      });
      callExecFile([hijackedShim, nativeExe].join('\r\n'));
      callExecFile('codex-cli 0.146.0');

      const { codexBinary } = await import('../cliAgentBinaries');
      const status = await codexBinary.detect();

      expect(status.available).toBe(true);
      expect(status.path).toBe(nativeExe);
      expect(execFileMock).toHaveBeenCalledTimes(2);
      expect(execFileMock.mock.calls[1]![0]).toBe(nativeExe);
    });

    it('reports unavailable when `where` only returns unrunnable matches (.ps1 / extensionless)', async () => {
      const unrunnableMatches = [
        'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude',
        'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude.ps1',
      ];
      callExecFile(unrunnableMatches.join('\r\n'));

      const { claudeCodeBinary } = await import('../cliAgentBinaries');
      const status = await claudeCodeBinary.detect();

      expect(status.available).toBe(false);
      // PATH recovery may issue registry queries and retry `where`, but must
      // never attempt to invoke either unrunnable result.
      expect(execMock).not.toHaveBeenCalled();
      const invokedFiles = execFileMock.mock.calls.map(([file]) => file);
      for (const match of unrunnableMatches) expect(invokedFiles).not.toContain(match);
    });
  });

  describe('on macOS / Linux with a Unix-style claude binary', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('darwin');
    });

    it('detects OpenCode through the shared command/version probe', async () => {
      callExecFile('/Users/test/.opencode/bin/opencode\n');
      callExecFile('1.18.3');

      const { opencodeBinary } = await import('../cliAgentBinaries');
      const status = await opencodeBinary.detect();

      expect(status).toMatchObject({
        available: true,
        path: '/Users/test/.opencode/bin/opencode',
        version: '1.18.3',
      });
    });

    it('detects Pi through the shared bare-version probe', async () => {
      callExecFile('/Users/test/.local/bin/pi\n');
      callExecFile('0.83.0');

      const { piBinary } = await import('../cliAgentBinaries');
      const status = await piBinary.detect();

      expect(status).toMatchObject({
        available: true,
        path: '/Users/test/.local/bin/pi',
        version: '0.83.0',
      });
    });

    it('detects Qoder through the shared bare-version probe', async () => {
      callExecFile('/Users/test/.local/bin/qodercli\n');
      callExecFile('1.1.15');

      const { qoderBinary } = await import('../cliAgentBinaries');
      const status = await qoderBinary.detect();

      expect(status).toMatchObject({
        available: true,
        path: '/Users/test/.local/bin/qodercli',
        version: '1.1.15',
      });
    });

    it('detects Factory Droid by its ACP capability', async () => {
      callExecFile('/Users/test/.local/bin/droid\n');
      callExecFile('0.206.0');
      callExecFile(DROID_ACP_HELP);

      const { droidBinary } = await import('../cliAgentBinaries');
      await expect(droidBinary.detect()).resolves.toMatchObject({
        available: true,
        path: '/Users/test/.local/bin/droid',
        version: '0.206.0',
      });
    });

    it('detects the official TRAE CLI by its ACP capability', async () => {
      callExecFile('/Users/test/.local/bin/traecli\n');
      callExecFile('trae-cli version 0.120.52');
      callExecFile(TRAE_ACP_HELP);

      const { traeBinary } = await import('../cliAgentBinaries');
      await expect(traeBinary.detect()).resolves.toMatchObject({
        available: true,
        path: '/Users/test/.local/bin/traecli',
        version: '0.120.52',
      });
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

    it('falls back to a user-local Claude install when `claude` is not on PATH', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which claude
        callExecFile('2.1.196 (Claude Code)'); // ~/.local/bin/claude --version

        const { claudeCodeBinary } = await import('../cliAgentBinaries');
        const status = await claudeCodeBinary.detect();

        expect(status.available).toBe(true);
        expect(status.path).toBe(path.join(os.homedir(), '.local', 'bin', 'claude'));
        expect(status.version).toBe('2.1.196');

        expect(execFileMock).toHaveBeenCalledTimes(2);
        expect(execFileMock.mock.calls[0]![0]).toBe('which');
        expect(execFileMock.mock.calls[1]![0]).toBe(
          path.join(os.homedir(), '.local', 'bin', 'claude'),
        );
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('does not fall back to well-known Claude paths for a custom command', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which claude-beta

        const { detectHeterogeneousCliCommand } = await import('../cliAgentBinaries');
        const status = await detectHeterogeneousCliCommand('claude-code', 'claude-beta');

        expect(status.available).toBe(false);
        // Only the custom command's own `which` runs — the ~/.local/bin/claude
        // fallback must NOT, or a missing `claude-beta` would silently resolve
        // to stock `claude` instead of reporting the configured command missing.
        expect(execFileMock).toHaveBeenCalledTimes(1);
        expect(execFileMock.mock.calls[0]![0]).toBe('which');
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('falls back to the ChatGPT.app bundled CLI when `codex` is not on any PATH', async () => {
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
        expect(status.path).toBe('/Applications/ChatGPT.app/Contents/Resources/codex');
        expect(status.version).toBe('0.138.0');

        expect(execFileMock).toHaveBeenCalledTimes(2);
        expect(execFileMock.mock.calls[0]![0]).toBe('which');
        expect(execFileMock.mock.calls[1]![0]).toBe(
          '/Applications/ChatGPT.app/Contents/Resources/codex',
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
        callExecFileError(new Error('ENOENT')); // /Applications/ChatGPT.app
        callExecFileError(new Error('ENOENT')); // ~/Applications/ChatGPT.app
        callExecFileError(new Error('ENOENT')); // /Applications/Codex.app
        callExecFileError(new Error('ENOENT')); // ~/Applications/Codex.app

        const { codexBinary } = await import('../cliAgentBinaries');
        const status = await codexBinary.detect();

        expect(status.available).toBe(false);
        expect(execFileMock).toHaveBeenCalledTimes(5);
        expect(execFileMock.mock.calls[4]![0]).toBe(
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
      // PATH recovery may retry the explicit launcher in a second environment,
      // but every version probe must keep that launcher rather than switching
      // to a built-in Codex fallback.
      const versionProbeFiles = execFileMock.mock.calls
        .filter(([, args]) => Array.isArray(args) && args.includes('--version'))
        .map(([file]) => file);
      expect(versionProbeFiles.length).toBeGreaterThan(0);
      expect(versionProbeFiles).toEqual(versionProbeFiles.map(() => '/custom/bin/codex'));
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
        expect(status.version).toBe('0.2.0');
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
