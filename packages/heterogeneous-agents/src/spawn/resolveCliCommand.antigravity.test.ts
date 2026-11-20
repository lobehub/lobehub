import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module captures `promisify(execFile)` at import time, so mock first.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => actual.platform()) };
});

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');
  return { ...actual, access: vi.fn(), readFile: vi.fn() };
});

const platformMock = vi.mocked(os.platform);
const execFileMock = vi.mocked(childProcess.execFile);
const execMock = vi.mocked(childProcess.exec);
const accessMock = vi.mocked(fsPromises.access);

/** Declare which paths exist on the fake host. */
const existingFiles = (files: Record<string, true>) => {
  const entries = new Set(Object.keys(files).map((filePath) => filePath.toLowerCase()));
  accessMock.mockImplementation(async (filePath) => {
    if (!entries.has(String(filePath).toLowerCase())) throw new Error(`missing: ${filePath}`);
  });
};

const queueExecFile = (err: Error | null, stdout = '', stderr = '') => {
  execFileMock.mockImplementationOnce(((file: string, args: any, opts: any, cb: any) => {
    // promisify-wrapped: the callback is always the last positional arg.
    const callback = typeof opts === 'function' ? opts : cb;
    callback(err, { stderr, stdout });
    return {} as any;
  }) as any);
};
const callExecFile = (stdout: string, stderr = '') => queueExecFile(null, stdout, stderr);
const callExecFileError = (err: Error) => queueExecFile(err);

const importModule = () => import('./resolveCliCommand');

describe('resolveCliCommand — Antigravity', () => {
  beforeEach(async () => {
    (await importModule()).invalidateLoginShellPathCache();
    execFileMock.mockReset();
    execMock.mockReset();
    accessMock.mockReset();
    // Fail unqueued calls fast instead of hanging until the test timeout.
    execFileMock.mockImplementation(((file: string, args: any, opts: any, cb: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(new Error(`unexpected execFile: ${file} ${JSON.stringify(args)}`), {
        stderr: '',
        stdout: '',
      });
      return {} as any;
    }) as any);
    existingFiles({});
    platformMock.mockReturnValue('darwin');
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('detects Antigravity stream-json and preserves prerelease/build versions', async () => {
    callExecFile('/Users/x/.local/bin/agy\n');
    callExecFile('1.2.13-beta.1+build.5');
    callExecFile('', '--input-format --output-format stream-json --conversation');
    const { detectHeterogeneousCliCommand } = await importModule();
    expect(await detectHeterogeneousCliCommand('antigravity', 'agy')).toMatchObject({
      available: true,
      path: '/Users/x/.local/bin/agy',
      version: '1.2.13-beta.1+build.5',
    });
  });

  it('rejects older agy versions that cannot stream input or resume', async () => {
    callExecFile('1.0.7');
    callExecFile('Usage: agy --print --output-format json');
    const { detectHeterogeneousCliCommand } = await importModule();
    expect(await detectHeterogeneousCliCommand('antigravity', '/tmp/old-agy')).toMatchObject({
      available: false,
    });
  });

  it('finds agy in the official Unix user install directory', async () => {
    const originalEnv = process.env;
    process.env = { ...process.env, PATH: '/usr/bin:/bin', SHELL: '' };
    try {
      callExecFileError(new Error('not found'));
      callExecFile('1.2.13');
      callExecFile('--input-format --output-format stream-json --conversation');
      const { detectHeterogeneousCliCommand } = await importModule();
      expect(await detectHeterogeneousCliCommand('antigravity', 'agy')).toMatchObject({
        available: true,
        path: path.join(os.homedir(), '.local', 'bin', 'agy'),
      });
    } finally {
      process.env = originalEnv;
    }
  });

  it('finds the native Windows agy executable outside inherited PATH', async () => {
    platformMock.mockReturnValue('win32');
    const originalLocal = process.env.LOCALAPPDATA;
    const originalPath = process.env.PATH;
    process.env.LOCALAPPDATA = 'C:\\Users\\Test User\\AppData\\Local';
    process.env.PATH = 'C:\\Windows';
    const binary = 'C:\\Users\\Test User\\AppData\\Local\\agy\\bin\\agy.exe';
    existingFiles({ [binary]: true });
    try {
      callExecFileError(new Error('not found'));
      callExecFileError(new Error('no registry PATH'));
      callExecFileError(new Error('no registry PATH'));
      callExecFile('1.2.13');
      callExecFile('--input-format --output-format stream-json --conversation');
      const { detectHeterogeneousCliCommand } = await importModule();
      expect(await detectHeterogeneousCliCommand('antigravity', 'agy')).toMatchObject({
        available: true,
        path: binary,
      });
      expect(execMock).not.toHaveBeenCalled();
    } finally {
      process.env.PATH = originalPath;
      if (originalLocal === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = originalLocal;
    }
  });
});
