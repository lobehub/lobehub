import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
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

// `resolveCliSpawnPlan` reads Windows shims off disk to find their real target,
// so shim scenarios need a fake filesystem.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');
  return { ...actual, access: vi.fn(), readFile: vi.fn() };
});

const platformMock = vi.mocked(os.platform);
const execFileMock = vi.mocked(childProcess.execFile);
const execMock = vi.mocked(childProcess.exec);
const accessMock = vi.mocked(fsPromises.access);
const readFileMock = vi.mocked(fsPromises.readFile);

/**
 * Declare the files that exist on the fake host. Map a path to its contents to
 * make it readable (shims), or to `true` for an opaque binary.
 */
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

const noErr = null;
const DROID_ACP_HELP = `Usage: droid exec [options] [prompt]
  --output-format <format>  Output format. ACP modes use bidirectional JSON-RPC.`;
const TRAE_ACP_HELP = `Start the ACP server

Usage:
  trae-cli acp serve [flags]

Flags:
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
const importModule = () => import('./resolveCliCommand');

describe('resolveCliCommand', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execMock.mockReset();
    accessMock.mockReset();
    readFileMock.mockReset();
    rejectUnqueuedExecFile();
    // Empty host by default — individual tests opt into the files they need.
    existingFiles({});
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('detectHeterogeneousCliCommand — macOS / Linux', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('darwin');
    });

    it('resolves Amp on PATH and reports its normalized version', async () => {
      callExecFile('/Users/x/.local/bin/amp\n');
      callExecFile('Amp CLI\n\nUsage: amp [options] [command]');
      callExecFile('0.0.1786551414-g7b8b6b (released 2026-08-12T16:16:54.000Z, 38m ago)');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('amp', 'amp');

      expect(status).toMatchObject({
        available: true,
        path: '/Users/x/.local/bin/amp',
        version: '0.0.1786551414-g7b8b6b',
      });
      expect(execFileMock.mock.calls[1]![1]).toEqual(['--help']);
      expect(execFileMock.mock.calls[2]![1]).toEqual(['--version']);
    });

    it('keeps an older Amp available when it does not support the version flag', async () => {
      callExecFile('/Users/x/.local/bin/amp\n');
      callExecFile('Amp CLI\n\nUsage: amp [options] [command]');
      callExecFileError(new Error('unknown option: --version'));

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('amp', 'amp');

      expect(status).toMatchObject({
        available: true,
        path: '/Users/x/.local/bin/amp',
      });
      expect(status.version).toBeUndefined();
    });

    it('resolves `codex` on PATH and validates it via execFile (no shell)', async () => {
      callExecFile('/usr/local/bin/codex\n');
      callExecFile('codex-cli 0.147.0-alpha.6.6');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('codex', 'codex');

      expect(status.available).toBe(true);
      expect(status.path).toBe('/usr/local/bin/codex');
      expect(status.version).toBe('0.147.0-alpha.6.6');
      expect(status.resolvedPathEnv).toBeUndefined();
      expect(execMock).not.toHaveBeenCalled();
    });

    it('validates Grok Build with its ACP agent-mode capability probe', async () => {
      callExecFile('grok 1.0.3 (ea094a8) [stable]');
      callExecFile('Usage: grok agent [OPTIONS] <stdio|leader>');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('grok-build', '/Users/x/.grok/bin/grok');

      expect(status).toMatchObject({
        available: true,
        path: '/Users/x/.grok/bin/grok',
        version: '1.0.3',
      });
      expect(execFileMock.mock.calls[0]![1]).toEqual(['--version']);
      expect(execFileMock.mock.calls[1]![1]).toEqual(['agent', '--help']);
    });

    it('resolves and validates OpenCode using its bare semver output', async () => {
      callExecFile('/Users/x/.opencode/bin/opencode\n');
      callExecFile('1.18.3');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('opencode', 'opencode');

      expect(status).toMatchObject({
        available: true,
        path: '/Users/x/.opencode/bin/opencode',
        version: '1.18.3',
      });
    });

    it('validates Kimi Code using its bare semver and stream-json capabilities', async () => {
      callExecFile('/Users/x/.kimi-code/bin/kimi\n');
      callExecFile('1.8.0');
      callExecFile('Usage: kimi --prompt <text> --output-format <format>');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('kimi-code', 'kimi');

      expect(status).toMatchObject({
        available: true,
        path: '/Users/x/.kimi-code/bin/kimi',
        version: '1.8.0',
      });
      expect(execFileMock.mock.calls[2]![1]).toEqual(['--help']);
    });

    it('rejects the retired kimi-cli when stream-json capabilities are missing', async () => {
      callExecFile('0.1.0');
      callExecFile('Usage: kimi chat [options]');

      const { detectHeterogeneousCliCommand } = await importModule();

      await expect(
        detectHeterogeneousCliCommand('kimi-code', '/Users/x/.local/bin/kimi'),
      ).resolves.toMatchObject({ available: false });
    });

    it('resolves and validates Qoder using its bare semver output', async () => {
      callExecFile('/Users/x/.local/bin/qodercli\n');
      callExecFile('1.1.15');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('qoder', 'qodercli');

      expect(status).toMatchObject({
        available: true,
        path: '/Users/x/.local/bin/qodercli',
        version: '1.1.15',
      });
    });

    it('resolves and validates CodeBuddy using its bare semver output', async () => {
      callExecFile('/Users/x/.local/bin/codebuddy\n');
      callExecFile('2.132.0');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('codebuddy', 'codebuddy');

      expect(status).toMatchObject({
        available: true,
        path: '/Users/x/.local/bin/codebuddy',
        version: '2.132.0',
      });
    });

    it("falls back to Cursor's unambiguous alias when another CLI owns `agent`", async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFile('/Users/x/.grok/bin/agent\n');
        callExecFile('Usage: agent [flags]\nGrok CLI agent');
        callExecFile('Usage: agent [flags]\nGrok CLI agent');
        callExecFile('Usage: agent [options] [command] [prompt...]\nStart the Cursor Agent');

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('cursor', 'agent');

        expect(status).toMatchObject({
          available: true,
          path: path.join(os.homedir(), '.local', 'bin', 'cursor-agent'),
          version: undefined,
        });
        expect(execFileMock.mock.calls[1]![1]).toEqual(['--help']);
        expect(execFileMock.mock.calls[2]![1]).toEqual(['--help']);
        expect(execFileMock.mock.calls[3]![1]).toEqual(['--help']);
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('requires both the Cursor product banner and agent command signature', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFile('/Users/x/bin/cursor-agent-custom\n');
        callExecFile('Start the Cursor Agent');

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('cursor', 'cursor-agent-custom');

        expect(status.available).toBe(false);
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('accepts the official TRAE banner when the CLI exposes the ACP runtime', async () => {
      callExecFile('/usr/local/bin/traecli\n');
      callExecFile(`trae-cli version 0.120.52
build date: 2026-08-12T01:31:30Z
build commit: 6756e52a9238b6d493928e55b05127957dbfefb4`);
      callExecFile(TRAE_ACP_HELP);

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('trae', 'traecli');

      expect(status).toMatchObject({
        available: true,
        path: '/usr/local/bin/traecli',
        version: '0.120.52',
      });
      expect(execFileMock.mock.calls[2]![1]).toEqual(['acp', 'serve', '--help']);
    });

    it('accepts Factory Droid only when droid exec exposes ACP output', async () => {
      callExecFile('/usr/local/bin/droid\n');
      callExecFile('0.206.0');
      callExecFile(DROID_ACP_HELP);

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('droid', 'droid');

      expect(status).toMatchObject({
        available: true,
        path: '/usr/local/bin/droid',
        version: '0.206.0',
      });
      expect(execFileMock.mock.calls[2]![1]).toEqual(['exec', '--help']);
    });

    it('rejects a droid binary without ACP output support', async () => {
      callExecFile('/usr/local/bin/droid\n');
      callExecFile('0.206.0');
      callExecFile('Usage: droid exec [options]\n--output-format text|jsonl');

      const { detectHeterogeneousCliCommand } = await importModule();

      await expect(detectHeterogeneousCliCommand('droid', 'droid')).resolves.toMatchObject({
        available: false,
      });
    });

    it('accepts the TRAE Enterprise CLI bare-semver banner', async () => {
      callExecFile('/usr/local/bin/traecli\n');
      callExecFile('1.4.0');
      callExecFile(TRAE_ACP_HELP);

      const { detectHeterogeneousCliCommand } = await importModule();

      await expect(detectHeterogeneousCliCommand('trae', 'traecli')).resolves.toMatchObject({
        available: true,
        path: '/usr/local/bin/traecli',
        version: '1.4.0',
      });
    });

    it('accepts the official canonical trae-cli executable when it exposes ACP', async () => {
      callExecFile('trae-cli version 0.120.52');
      callExecFile(TRAE_ACP_HELP);
      const probeEnv = { ...process.env, PATH: '/custom/node/bin:/usr/bin' };

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand(
        'trae',
        '/usr/local/bin/trae-cli',
        probeEnv,
      );

      expect(status).toMatchObject({
        available: true,
        path: '/usr/local/bin/trae-cli',
        resolvedPathEnv: '/custom/node/bin:/usr/bin',
        version: '0.120.52',
      });
      expect(execFileMock.mock.calls[0]![2]).toMatchObject({ env: probeEnv });
      expect(execFileMock.mock.calls[1]![2]).toMatchObject({ env: probeEnv });
    });

    it('rejects the unrelated trae-cli trajectory runner by its missing ACP capability', async () => {
      callExecFile('/usr/local/bin/traecli\n');
      callExecFile('trae-cli 0.1.0');
      callExecFileError(new Error('unknown command "acp"'));

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('trae', 'traecli-renamed');

      expect(status.available).toBe(false);
      expect(execFileMock.mock.calls[2]![1]).toEqual(['acp', 'serve', '--help']);
    });

    it('finds OpenCode in its well-known user-local install path', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which opencode
        callExecFile('1.18.3'); // ~/.opencode/bin/opencode --version

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('opencode', 'opencode');

        expect(status).toMatchObject({
          available: true,
          path: path.join(os.homedir(), '.opencode', 'bin', 'opencode'),
          version: '1.18.3',
        });
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('prefers the login-PATH command over an inherited absolute fallback', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';
      const loginPath = '/login/bin:/usr/bin:/bin';
      const loginCommand = '/login/bin/opencode';
      const fallbackPath = '/fallback/bin/opencode';

      execFileMock.mockImplementation(((file: string, args: any, opts: any, cb: any) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (file === '/bin/zsh') {
          callback(noErr, { stderr: '', stdout: loginPath });
        } else if (file === 'which' && opts.env?.PATH === loginPath) {
          callback(noErr, { stderr: '', stdout: `${loginCommand}\n` });
        } else if (file === 'which') {
          callback(new Error('not found'), { stderr: '', stdout: '' });
        } else if (file === loginCommand || file === fallbackPath) {
          callback(noErr, { stderr: '', stdout: '1.18.3' });
        } else {
          callback(new Error(`unexpected execFile: ${file}`), { stderr: '', stdout: '' });
        }
        return {} as any;
      }) as any);

      try {
        const { detectValidatedCommandCandidates } = await importModule();
        const status = await detectValidatedCommandCandidates(['opencode', fallbackPath], {
          validatePattern: /^v?\d+\.\d+\.\d+$/,
        });

        expect(status).toMatchObject({
          available: true,
          path: loginCommand,
          resolvedPathEnv: loginPath,
        });
        expect(execFileMock.mock.calls.map(([file]) => file)).not.toContain(fallbackPath);
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });

    it('keeps an inherited fallback available when the recovered environment would break it', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';
      const loginPath = '/broken/bin:/usr/bin:/bin';
      const fallbackPath = '/fallback/bin/opencode';

      execFileMock.mockImplementation(((file: string, args: any, opts: any, cb: any) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (file === '/bin/zsh') {
          callback(noErr, { stderr: '', stdout: loginPath });
        } else if (file === 'which') {
          callback(new Error('not found'), { stderr: '', stdout: '' });
        } else if (file === fallbackPath && opts.env?.PATH !== loginPath) {
          callback(noErr, { stderr: '', stdout: '1.18.3' });
        } else {
          callback(new Error('broken recovered environment'), { stderr: '', stdout: '' });
        }
        return {} as any;
      }) as any);

      try {
        const { detectValidatedCommandCandidates } = await importModule();
        const status = await detectValidatedCommandCandidates(['opencode', fallbackPath], {
          validatePattern: /^v?\d+\.\d+\.\d+$/,
        });

        expect(status).toMatchObject({ available: true, path: fallbackPath });
        expect(status.resolvedPathEnv).toBeUndefined();
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });

    it('carries the recovered login PATH into an absolute fallback launcher', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';
      const loginPath = '/opt/homebrew/bin:/usr/bin:/bin';
      const fallbackPath = path.join(os.homedir(), '.opencode', 'bin', 'opencode');

      try {
        callExecFileError(new Error('not found')); // which opencode (inherited PATH)
        callExecFile(loginPath); // login shell PATH contains node, not opencode
        callExecFileError(new Error('not found')); // which opencode (login PATH)
        callExecFileError(new Error('node not found')); // fallback under inherited PATH
        callExecFile('1.18.3'); // ~/.opencode/bin/opencode --version

        const { detectValidatedCommandCandidates } = await importModule();
        const status = await detectValidatedCommandCandidates(['opencode', fallbackPath], {
          validatePattern: /^v?\d+\.\d+\.\d+$/,
        });

        expect(status).toMatchObject({
          available: true,
          path: fallbackPath,
          resolvedPathEnv: loginPath,
          version: '1.18.3',
        });
        expect((execFileMock.mock.calls[4]![2] as { env: NodeJS.ProcessEnv }).env.PATH).toBe(
          loginPath,
        );
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });

    it('retries an explicit env-based launcher with the recovered login PATH', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';
      const commandPath = '/Users/x/.local/bin/opencode';
      const loginPath = '/opt/homebrew/bin:/usr/bin:/bin';

      try {
        callExecFileError(new Error('node not found')); // inherited PATH
        callExecFile(loginPath); // login shell exposes node
        callExecFile('1.18.3'); // exact same launcher under recovered PATH

        const { detectValidatedCommand } = await importModule();
        const status = await detectValidatedCommand(commandPath, {
          validatePattern: /^v?\d+\.\d+\.\d+$/,
        });

        expect(status).toMatchObject({
          available: true,
          path: commandPath,
          resolvedPathEnv: loginPath,
          version: '1.18.3',
        });
        expect((execFileMock.mock.calls[2]![2] as { env: NodeJS.ProcessEnv }).env.PATH).toBe(
          loginPath,
        );
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });

    it('recovers the login PATH after an inherited command fails validation', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/local/bin:/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';
      const loginPath = '/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin';
      const fallbackPath = path.join(os.homedir(), '.opencode', 'bin', 'opencode');

      try {
        callExecFile('/usr/local/bin/opencode\n'); // inherited PATH finds a stale launcher
        callExecFileError(new Error('stale launcher')); // inherited launcher validation
        callExecFile('/opt/homebrew/bin:/usr/bin:/bin'); // login shell PATH
        callExecFile('/usr/local/bin/opencode\n'); // retry under the merged PATH
        callExecFileError(new Error('stale launcher')); // recovered lookup still resolves stale copy
        callExecFileError(new Error('node not found')); // fallback under inherited PATH
        callExecFile('1.18.3'); // ~/.opencode/bin/opencode --version

        const { detectValidatedCommandCandidates } = await importModule();
        const status = await detectValidatedCommandCandidates(['opencode', fallbackPath], {
          validatePattern: /^v?\d+\.\d+\.\d+$/,
        });

        expect(status).toMatchObject({
          available: true,
          path: fallbackPath,
          resolvedPathEnv: loginPath,
          version: '1.18.3',
        });
        expect((execFileMock.mock.calls[6]![2] as { env: NodeJS.ProcessEnv }).env.PATH).toBe(
          loginPath,
        );
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });

    it('finds Kimi Code in its official user-local install path', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      delete process.env.SHELL;

      try {
        callExecFileError(new Error('not found')); // which kimi
        callExecFile('1.8.0'); // ~/.kimi-code/bin/kimi --version
        callExecFile('Usage: kimi --prompt <text> --output-format <format>');

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('kimi-code', 'kimi');

        expect(status).toMatchObject({
          available: true,
          path: path.join(os.homedir(), '.kimi-code', 'bin', 'kimi'),
          version: '1.8.0',
        });
      } finally {
        process.env.PATH = originalPath;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
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

        const { detectValidatedCommand } = await importModule();
        const status = await detectValidatedCommand('codex', { validateKeywords: ['codex'] });

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

    it('re-reads the login-shell PATH on a later scan', async () => {
      const originalPath = process.env.PATH;
      const originalShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';

      try {
        const { detectValidatedCommand } = await importModule();
        const options = { validateKeywords: ['new-agent'] };

        callExecFileError(new Error('not found')); // which new-agent
        callExecFile('/usr/bin:/bin'); // login shell before installation
        expect((await detectValidatedCommand('new-agent', options)).available).toBe(false);

        callExecFileError(new Error('not found')); // inherited PATH is still stale
        callExecFile('/Users/x/.local/bin:/usr/bin:/bin'); // shell PATH after installation
        callExecFile('/Users/x/.local/bin/new-agent\n');
        callExecFile('new-agent 1.2.3');

        await expect(detectValidatedCommand('new-agent', options)).resolves.toMatchObject({
          available: true,
          path: '/Users/x/.local/bin/new-agent',
          resolvedPathEnv: '/Users/x/.local/bin:/usr/bin:/bin',
          version: '1.2.3',
        });
        expect(execFileMock.mock.calls.filter(([command]) => command === '/bin/zsh')).toHaveLength(
          2,
        );
      } finally {
        process.env.PATH = originalPath;
        process.env.SHELL = originalShell;
      }
    });
  });

  describe('detectValidatedCommand — Windows npm shims', () => {
    const NPM_DIR = 'C:\\Users\\x\\AppData\\Roaming\\npm';
    // A stock npm shim, the shape `resolveCliSpawnPlan` knows how to unwrap.
    const npmShim = (packagePath: string) =>
      `@ECHO off\r\n"%dp0%\\node.exe"  "%dp0%\\${packagePath}" %*\r\n`;

    beforeEach(() => {
      platformMock.mockReturnValue('win32');
    });

    it('resolves `codex` to the .cmd shim without constructing a shell command', async () => {
      const shimPath = `${NPM_DIR}\\codex.cmd`;
      const scriptPath = `${NPM_DIR}\\node_modules\\@openai\\codex\\bin\\codex.js`;
      existingFiles({
        [`${NPM_DIR}\\node.exe`]: true,
        [scriptPath]: true,
        [shimPath]: npmShim('node_modules\\@openai\\codex\\bin\\codex.js'),
      });
      callExecFile(`${shimPath}\r\n`);
      callExecFile('codex 0.142.5');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('codex', { validateKeywords: ['codex'] });

      expect(status.available).toBe(true);
      expect(status.path).toBe(shimPath);
      // The shim is unwrapped to node + script, never handed to a shell.
      expect(execFileMock.mock.calls[1]![0]).toBe(`${NPM_DIR}\\node.exe`);
      expect(execFileMock.mock.calls[1]![1]).toEqual([scriptPath, '--version']);
      expect(execMock).not.toHaveBeenCalled();
    });

    it('prefers the .cmd shim when `where` returns multiple PATHEXT matches', async () => {
      const shimPath = `${NPM_DIR}\\codex.cmd`;
      existingFiles({
        [`${NPM_DIR}\\node.exe`]: true,
        [`${NPM_DIR}\\node_modules\\@openai\\codex\\bin\\codex.js`]: true,
        [shimPath]: npmShim('node_modules\\@openai\\codex\\bin\\codex.js'),
      });
      callExecFile([`${NPM_DIR}\\codex`, shimPath, `${NPM_DIR}\\codex.ps1`].join('\r\n'));
      callExecFile('codex 0.142.5');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('codex', { validateKeywords: ['codex'] });

      expect(status.available).toBe(true);
      expect(status.path).toBe(shimPath);
    });

    it('preserves PATH order: a runnable earlier .cmd beats a later .exe (Vite+ claude.exe case)', async () => {
      // `where claude` lists every match in PATH order. npm's .cmd shim is
      // earlier; Vite+ ships a later standalone claude.exe. Preferring every
      // .exe over every .cmd would pick Vite+ and break the real install.
      const shimDir = 'C:\\Users\\hp\\AppData\\Roaming\\npm';
      const shimPath = `${shimDir}\\claude.cmd`;
      existingFiles({
        [`${shimDir}\\node.exe`]: true,
        [`${shimDir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: true,
        [shimPath]: npmShim('node_modules\\@anthropic-ai\\claude-code\\cli.js'),
      });
      callExecFile([shimPath, 'C:\\Users\\hp\\.vite-plus\\bin\\claude.exe'].join('\r\n'));
      callExecFile('1.2.3 (Claude Code)');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('claude', {
        validateKeywords: ['claude code'],
      });

      expect(status.available).toBe(true);
      expect(status.path).toBe(shimPath);
    });

    it('walks past a third-party shim it cannot unwrap to a later native .exe', async () => {
      // OpenCodex hijacks %APPDATA%\npm\codex.cmd and forwards through a custom
      // variable, so none of the shim patterns match. The WindowsApps codex.exe
      // further down PATH runs fine — it just has to get a turn.
      const hijackedShim = `${NPM_DIR}\\codex.cmd`;
      const nativeExe =
        'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0_x64\\app\\resources\\codex.exe';
      existingFiles({
        [hijackedShim]: [
          '@echo off',
          'set "OCX_REAL_CODEX=%APPDATA%\\npm\\codex.opencodex-real.cmd"',
          ':run_codex',
          '"%OCX_REAL_CODEX%" %*',
        ].join('\r\n'),
        [nativeExe]: true,
      });
      callExecFile([`${NPM_DIR}\\codex`, hijackedShim, nativeExe].join('\r\n'));
      callExecFile('codex-cli 0.146.0');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('codex', { validateKeywords: ['codex'] });

      expect(status).toMatchObject({
        available: true,
        path: nativeExe,
        version: '0.146.0',
      });
      // The unrunnable shim is never spawned: `execFile` on a .cmd throws
      // EINVAL since the CVE-2024-27980 fix, so trying it would only waste a
      // process launch.
      expect(execFileMock.mock.calls[1]![0]).toBe(nativeExe);
      expect(execFileMock).toHaveBeenCalledTimes(2);
    });

    it('probes an unwrappable shim through %ComSpec% when it is the only candidate', async () => {
      const originalComSpec = process.env.ComSpec;
      process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
      const hijackedShim = `${NPM_DIR}\\qodercli.cmd`;
      existingFiles({ [hijackedShim]: '@echo off\r\n"%OCX_REAL%" %*\r\n' });

      try {
        callExecFile(`${hijackedShim}\r\n`);
        callExecFile('1.0.39');

        const { detectValidatedCommand } = await importModule();
        const status = await detectValidatedCommand('qodercli', {
          validatePattern: /^v?\d+\.\d+\.\d+$/,
        });

        expect(status).toMatchObject({ available: true, path: hijackedShim, version: '1.0.39' });
        expect(execFileMock.mock.calls[1]![0]).toBe('C:\\Windows\\System32\\cmd.exe');
        expect(execFileMock.mock.calls[1]![1]).toEqual([
          '/d',
          '/s',
          '/c',
          `""${hijackedShim}" --version"`,
        ]);
      } finally {
        if (originalComSpec === undefined) delete process.env.ComSpec;
        else process.env.ComSpec = originalComSpec;
      }
    });

    it('retries `where` against the registry PATH when the inherited snapshot is stale', async () => {
      // A process started before the CLI installer ran keeps the PATH it
      // inherited at creation time and never sees the new directory.
      const originalPath = process.env.PATH;
      const originalSystemRoot = process.env.SystemRoot;
      const codexBin = 'C:\\Users\\x\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin';
      process.env.PATH = 'C:\\Windows';
      process.env.SystemRoot = 'C:\\Windows';

      try {
        existingFiles({ [`${codexBin}\\codex.exe`]: true });
        callExecFileError(new Error('INFO: Could not find files')); // where codex
        callExecFileError(new Error('ERROR: access denied')); // reg query HKLM
        callExecFile(
          `\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    ${codexBin};%SystemRoot%\\system32\r\n\r\n`,
        );
        callExecFile(`${codexBin}\\codex.exe\r\n`); // where codex (recovered PATH)
        callExecFile('codex-cli 0.147.0');

        const { detectValidatedCommand } = await importModule();
        const status = await detectValidatedCommand('codex', { validateKeywords: ['codex'] });

        expect(status.available).toBe(true);
        expect(status.path).toBe(`${codexBin}\\codex.exe`);

        const regArgs = execFileMock.mock.calls[1]![1] as string[];
        expect(regArgs[1]).toContain('Session Manager\\Environment');
        const retryEnv = (execFileMock.mock.calls[3]![2] as { env: NodeJS.ProcessEnv }).env;
        expect(retryEnv.PATH).toContain(codexBin);
        // REG_EXPAND_SZ values keep %VAR% references verbatim — `where` needs
        // them expanded.
        expect(retryEnv.PATH).toContain('C:\\Windows\\system32');
        expect(retryEnv.PATH).not.toContain('%SystemRoot%');
        // The recovered PATH is surfaced so spawn sites inherit it too.
        expect(status.resolvedPathEnv).toBe(retryEnv.PATH);
      } finally {
        process.env.PATH = originalPath;
        if (originalSystemRoot === undefined) delete process.env.SystemRoot;
        else process.env.SystemRoot = originalSystemRoot;
      }
    });

    it('re-reads the registry on a later scan instead of reusing the first answer', async () => {
      // The user installs the CLI while the app is already open: the first
      // scan sees neither the process PATH nor the registry, the rescan must
      // see the registry entry the installer just wrote.
      const originalPath = process.env.PATH;
      const qoderBin = 'C:\\Users\\x\\AppData\\Local\\Programs\\Qoder\\bin';
      process.env.PATH = 'C:\\Windows';

      try {
        existingFiles({ [`${qoderBin}\\qodercli.exe`]: true });
        const { detectValidatedCommand } = await importModule();
        const options = { validatePattern: /^v?\d+\.\d+\.\d+$/ };

        callExecFileError(new Error('not found')); // where qodercli
        callExecFileError(new Error('no value')); // reg query HKLM
        callExecFileError(new Error('no value')); // reg query HKCU
        expect((await detectValidatedCommand('qodercli', options)).available).toBe(false);

        callExecFileError(new Error('not found')); // where qodercli
        callExecFileError(new Error('no value')); // reg query HKLM
        callExecFile(
          `\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    ${qoderBin}\r\n`,
        );
        callExecFile(`${qoderBin}\\qodercli.exe\r\n`); // where qodercli (recovered PATH)
        callExecFile('1.0.39');

        const status = await detectValidatedCommand('qodercli', options);

        expect(status).toMatchObject({ available: true, path: `${qoderBin}\\qodercli.exe` });
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('prefers a registry-PATH command over an inherited absolute fallback', async () => {
      const originalPath = process.env.PATH;
      process.env.PATH = 'C:\\Windows';
      const registryBin = 'C:\\registry\\bin';
      const registryCommand = `${registryBin}\\codex.exe`;
      const fallbackPath = 'C:\\fallback\\codex.exe';
      existingFiles({ [fallbackPath]: true, [registryCommand]: true });

      execFileMock.mockImplementation(((file: string, args: any, opts: any, cb: any) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (file === 'where' && opts.env?.PATH && opts.env.PATH !== process.env.PATH) {
          callback(noErr, { stderr: '', stdout: `${registryCommand}\r\n` });
        } else if (file === 'where') {
          callback(new Error('not found'), { stderr: '', stdout: '' });
        } else if (file === 'reg' && String(args[1]).includes('HKCU')) {
          callback(noErr, {
            stderr: '',
            stdout: `\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_SZ    ${registryBin}\r\n`,
          });
        } else if (file === 'reg') {
          callback(new Error('no value'), { stderr: '', stdout: '' });
        } else if (file === registryCommand || file === fallbackPath) {
          callback(noErr, { stderr: '', stdout: 'codex-cli 0.147.0' });
        } else {
          callback(new Error(`unexpected execFile: ${file}`), { stderr: '', stdout: '' });
        }
        return {} as any;
      }) as any);

      try {
        const { detectValidatedCommandCandidates } = await importModule();
        const status = await detectValidatedCommandCandidates(['codex', fallbackPath], {
          validateKeywords: ['codex'],
        });

        expect(status).toMatchObject({ available: true, path: registryCommand });
        expect(status.resolvedPathEnv).toContain(registryBin);
        expect(execFileMock.mock.calls.map(([file]) => file)).not.toContain(fallbackPath);
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('falls back to the Windows Codex app bundled CLI when nothing is on PATH', async () => {
      const originalLocalAppData = process.env.LOCALAPPDATA;
      const originalPath = process.env.PATH;
      const localAppData = 'C:\\Users\\x\\AppData\\Local';
      process.env.LOCALAPPDATA = localAppData;
      // Single-segment PATH: the recovered PATH then matches it exactly, so no
      // extra `where` retry runs.
      process.env.PATH = 'C:\\Windows';
      const bundledCli = `${localAppData}\\Programs\\OpenAI\\Codex\\bin\\codex.exe`;

      try {
        existingFiles({ [bundledCli]: true });
        callExecFileError(new Error('not found')); // where codex
        callExecFileError(new Error('no registry')); // reg query HKLM
        callExecFileError(new Error('no registry')); // reg query HKCU
        callExecFile('codex-cli 0.147.0'); // the bundled CLI

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('codex', 'codex');

        expect(status.available).toBe(true);
        expect(status.path).toBe(bundledCli);
      } finally {
        process.env.PATH = originalPath;
        if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
        else process.env.LOCALAPPDATA = originalLocalAppData;
      }
    });

    it('finds the current TRAE public CLI executable when PATH is missing it', async () => {
      const originalLocalAppData = process.env.LOCALAPPDATA;
      const originalPath = process.env.PATH;
      const localAppData = 'C:\\Users\\x\\AppData\\Local';
      const traeCli = `${localAppData}\\Programs\\TraeCLI\\bin\\traex.exe`;
      process.env.LOCALAPPDATA = localAppData;
      process.env.PATH = 'C:\\Windows';

      try {
        existingFiles({ [traeCli]: true });
        callExecFileError(new Error('not found')); // where traecli
        callExecFileError(new Error('no registry')); // reg query HKLM
        callExecFileError(new Error('no registry')); // reg query HKCU
        callExecFile('traecli 0.201.2 (public edition)');
        callExecFile(TRAE_ACP_HELP);

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('trae', 'traecli');

        expect(status).toMatchObject({
          available: true,
          path: traeCli,
          version: '0.201.2',
        });
      } finally {
        process.env.PATH = originalPath;
        if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
        else process.env.LOCALAPPDATA = originalLocalAppData;
      }
    });

    it('still finds TRAE in its legacy Windows install directory', async () => {
      const originalLocalAppData = process.env.LOCALAPPDATA;
      const originalPath = process.env.PATH;
      const localAppData = 'C:\\Users\\x\\AppData\\Local';
      const traeCli = `${localAppData}\\trae-cli\\bin\\traecli.exe`;
      process.env.LOCALAPPDATA = localAppData;
      process.env.PATH = 'C:\\Windows';

      try {
        existingFiles({ [traeCli]: true });
        callExecFileError(new Error('not found')); // where traecli
        callExecFileError(new Error('no registry')); // reg query HKLM
        callExecFileError(new Error('no registry')); // reg query HKCU
        callExecFileError(new Error('not found')); // current Programs/TraeCLI/bin/traex.exe
        callExecFile('trae-cli version 0.120.52');
        callExecFile(TRAE_ACP_HELP);

        const { detectHeterogeneousCliCommand } = await importModule();
        const status = await detectHeterogeneousCliCommand('trae', 'traecli');

        expect(status).toMatchObject({
          available: true,
          path: traeCli,
          version: '0.120.52',
        });
      } finally {
        process.env.PATH = originalPath;
        if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
        else process.env.LOCALAPPDATA = originalLocalAppData;
      }
    });

    it('capability-probes a Kimi .cmd shim without constructing a shell command', async () => {
      const commandPath = 'C:\\Users\\x\\AppData\\Roaming\\npm\\kimi.cmd';
      const scriptPath = 'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\kimi-code\\cli.js';
      existingFiles({
        [`${NPM_DIR}\\node.exe`]: true,
        [commandPath]: npmShim('node_modules\\kimi-code\\cli.js'),
        [scriptPath]: true,
      });
      callExecFile(`${commandPath}\r\n`);
      callExecFile('1.8.0');
      callExecFile('Usage: kimi --prompt <text> --output-format <format>');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('kimi', {
        validateHelpKeywords: ['--prompt', '--output-format'],
        validatePattern: /^\d+\.\d+\.\d+$/,
      });

      expect(status.available).toBe(true);
      expect(execFileMock.mock.calls[1]![0]).toBe(`${NPM_DIR}\\node.exe`);
      expect(execFileMock.mock.calls[1]![1]).toEqual([scriptPath, '--version']);
      expect(execFileMock.mock.calls[2]![0]).toBe(`${NPM_DIR}\\node.exe`);
      expect(execFileMock.mock.calls[2]![1]).toEqual([scriptPath, '--help']);
      expect(execMock).not.toHaveBeenCalled();
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

  describe('detectValidatedCommand — noisy --version output', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('darwin');
    });

    it('validates the version line even when the CLI appends an upgrade notice', async () => {
      callExecFile('/Users/x/.local/bin/qodercli\n');
      callExecFile('1.0.39\nA new version (1.0.42) is available. Run `qodercli upgrade`.');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('qoder', 'qodercli');

      expect(status).toMatchObject({ available: true, version: '1.0.39' });
    });

    it('validates the version line even when Node writes a warning to stderr', async () => {
      callExecFile('/Users/x/.local/bin/opencode\n');
      callExecFile('1.18.3\n', '(node:14512) ExperimentalWarning: WASI is an experimental feature');

      const { detectHeterogeneousCliCommand } = await importModule();
      const status = await detectHeterogeneousCliCommand('opencode', 'opencode');

      expect(status).toMatchObject({ available: true, version: '1.18.3' });
    });

    it('reports the semantic version instead of an OpenClaw build hash', async () => {
      callExecFile('/Users/x/.local/bin/openclaw\n');
      callExecFile('openclaw 2026.8.8 (0790d9f)');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('openclaw', {
        validateKeywords: ['openclaw'],
      });

      expect(status).toMatchObject({ available: true, version: '2026.8.8' });
    });

    it('still rejects output whose first line is not a version', async () => {
      callExecFile('/Users/x/.local/bin/qodercli\n');
      callExecFile('Usage: qodercli [command]\n1.0.39');

      const { detectValidatedCommand } = await importModule();
      const status = await detectValidatedCommand('qodercli', {
        validatePattern: /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/,
      });

      expect(status.available).toBe(false);
    });
  });

  describe('resolveHeteroSpawnCommand', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('darwin');
    });

    it('uses amp as the default command for the AMP adapter', async () => {
      callExecFile('/Users/x/.local/bin/amp\n');
      callExecFile('Amp CLI');
      callExecFile('0.0.1786551414-g7b8b6b');

      const { resolveHeteroSpawnCommand } = await importModule();
      const resolved = await resolveHeteroSpawnCommand('amp', undefined);

      expect(resolved.command).toBe('/Users/x/.local/bin/amp');
    });

    it('defines opencode as the default OpenCode command', async () => {
      const { DEFAULT_HETERO_COMMAND } = await importModule();
      expect(DEFAULT_HETERO_COMMAND.opencode).toBe('opencode');
    });

    it('defines agent as the default Cursor command', async () => {
      const { DEFAULT_HETERO_COMMAND } = await importModule();
      expect(DEFAULT_HETERO_COMMAND.cursor).toBe('agent');
    });

    it('defines grok as the default Grok Build command', async () => {
      const { DEFAULT_HETERO_COMMAND } = await importModule();
      expect(DEFAULT_HETERO_COMMAND['grok-build']).toBe('grok');
    });

    it('defines pi as the default Pi command', async () => {
      const { DEFAULT_HETERO_COMMAND } = await importModule();
      expect(DEFAULT_HETERO_COMMAND.pi).toBe('pi');
    });

    it('defines qodercli as the default Qoder command', async () => {
      const { DEFAULT_HETERO_COMMAND } = await importModule();
      expect(DEFAULT_HETERO_COMMAND.qoder).toBe('qodercli');
    });

    it('defines traecli as the default TRAE command', async () => {
      const { DEFAULT_HETERO_COMMAND } = await importModule();
      expect(DEFAULT_HETERO_COMMAND.trae).toBe('traecli');
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
