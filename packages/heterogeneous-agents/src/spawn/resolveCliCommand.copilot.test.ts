import * as childProcess from 'node:child_process';
import * as os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The resolver captures `promisify(execFile)` at import time, so mock first.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => actual.platform()) };
});

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(childProcess.execFile);

/** `copilot --version` and `copilot --help` as printed by @github/copilot 1.0.105. */
const COPILOT_VERSION = `GitHub Copilot CLI 1.0.105.
Run 'copilot update' to check for updates.`;
const COPILOT_HELP = `Usage: copilot [options] [command]
      --acp
          Start as Agent Client Protocol server`;

const callExecFile = (stdout: string) => {
  execFileMock.mockImplementationOnce(((_file: string, _args: any, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    callback(null, { stderr: '', stdout });
    return {} as any;
  }) as any);
};

const callExecFileError = (error: Error) => {
  execFileMock.mockImplementationOnce(((_file: string, _args: any, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    callback(error, { stderr: '', stdout: '' });
    return {} as any;
  }) as any);
};

const importModule = () => import('./resolveCliCommand');

describe('detectHeterogeneousCliCommand — GitHub Copilot', () => {
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;

  beforeEach(async () => {
    (await importModule()).invalidateLoginShellPathCache();
    execFileMock.mockReset();
    execFileMock.mockImplementation(((file: string, args: any, opts: any, cb: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(new Error(`unexpected execFile: ${file} ${JSON.stringify(args)}`), {
        stderr: '',
        stdout: '',
      });
      return {} as any;
    }) as any);
    vi.mocked(os.platform).mockReturnValue('linux');
    process.env.PATH = '/usr/bin:/bin';
    delete process.env.SHELL;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
    vi.resetModules();
  });

  it('accepts the GitHub banner when the CLI can serve ACP', async () => {
    callExecFile('/usr/bin/copilot\n');
    callExecFile(COPILOT_VERSION);
    callExecFile(COPILOT_HELP);

    const { detectHeterogeneousCliCommand } = await importModule();
    const status = await detectHeterogeneousCliCommand('copilot', 'copilot');

    expect(status).toMatchObject({ available: true, path: '/usr/bin/copilot', version: '1.0.105' });
    expect(execFileMock.mock.calls[1]![1]).toEqual(['--version']);
    expect(execFileMock.mock.calls[2]![1]).toEqual(['--help']);
  });

  it("rejects AWS's unrelated `copilot` CLI", async () => {
    callExecFile('copilot version: v1.34.1');

    const { detectHeterogeneousCliCommand } = await importModule();

    await expect(detectHeterogeneousCliCommand('copilot', '/usr/bin/copilot')).resolves.toEqual({
      available: false,
    });
  });

  it('rejects a GitHub Copilot build that cannot serve ACP', async () => {
    callExecFile(COPILOT_VERSION);
    callExecFile('Usage: copilot [options] [command]\n  -p, --prompt <text>');

    const { detectHeterogeneousCliCommand } = await importModule();

    await expect(detectHeterogeneousCliCommand('copilot', '/usr/bin/copilot')).resolves.toEqual({
      available: false,
    });
  });

  it("finds the install script's ~/.local/bin copy when PATH does not list it", async () => {
    callExecFileError(new Error('not found')); // which copilot
    callExecFile(COPILOT_VERSION); // ~/.local/bin/copilot --version
    callExecFile(COPILOT_HELP);

    const { detectHeterogeneousCliCommand } = await importModule();
    const status = await detectHeterogeneousCliCommand('copilot', 'copilot');

    expect(status).toMatchObject({
      available: true,
      path: path.join(os.homedir(), '.local', 'bin', 'copilot'),
      version: '1.0.105',
    });
  });
});
