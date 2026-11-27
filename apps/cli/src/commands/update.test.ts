import type * as ChildProcessModule from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printConnectStatus } from './connectStatus';
import {
  buildInstallCommand,
  fetchLatestVersion,
  isNewerVersion,
  reportInstalledConnectStatus,
} from './update';

const { execFile, spawn } = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  execFile,
  spawn,
}));
vi.mock('./connectStatus', () => ({ printConnectStatus: vi.fn() }));

describe('isNewerVersion', () => {
  it('compares core versions', () => {
    expect(isNewerVersion('1.2.3', '1.2.2')).toBe(true);
    expect(isNewerVersion('1.2.2', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('tolerates a leading v and missing segments', () => {
    expect(isNewerVersion('v1.2.0', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.3', '1.2.9')).toBe(true);
  });

  it('ranks a stable release above a prerelease of the same core', () => {
    expect(isNewerVersion('1.2.3', '1.2.3-beta.1')).toBe(true);
    expect(isNewerVersion('1.2.3-beta.1', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.3-beta.2', '1.2.3-beta.1')).toBe(true);
    expect(isNewerVersion('1.2.3-beta.1', '1.2.3-beta.1')).toBe(false);
  });

  it('orders numeric prerelease identifiers numerically, not lexicographically', () => {
    // The bug a raw string compare gets wrong: beta.10 must outrank beta.9.
    expect(isNewerVersion('1.0.0-beta.10', '1.0.0-beta.9')).toBe(true);
    expect(isNewerVersion('1.0.0-beta.9', '1.0.0-beta.10')).toBe(false);
    expect(isNewerVersion('1.0.0-beta.2', '1.0.0-beta.10')).toBe(false);
  });

  it('returns false for an unparseable latest version', () => {
    expect(isNewerVersion('not-a-version', '1.0.0')).toBe(false);
  });
});

describe('buildInstallCommand', () => {
  it('builds the global install command per package manager', () => {
    expect(buildInstallCommand('npm', '@lobehub/cli@1.0.0')).toEqual({
      args: ['install', '-g', '@lobehub/cli@1.0.0'],
      command: 'npm',
    });
    expect(buildInstallCommand('pnpm', '@lobehub/cli@1.0.0')).toEqual({
      args: ['add', '-g', '@lobehub/cli@1.0.0'],
      command: 'pnpm',
    });
    expect(buildInstallCommand('bun', '@lobehub/cli@1.0.0')).toEqual({
      args: ['add', '-g', '@lobehub/cli@1.0.0'],
      command: 'bun',
    });
    expect(buildInstallCommand('yarn', '@lobehub/cli@1.0.0')).toEqual({
      args: ['global', 'add', '@lobehub/cli@1.0.0'],
      command: 'yarn',
    });
  });
});

describe('reportInstalledConnectStatus', () => {
  let originalArgv: string[];
  const entry = '/global/node_modules/@lobehub/cli/dist/index.js';
  const installedReports = (version: string) =>
    execFile.mockImplementation((_command, _args, _options, callback) =>
      callback(null, `${version}\n`),
    );
  const statusExits = (code: number) =>
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', code));
      return child;
    });

  beforeEach(() => {
    originalArgv = process.argv;
    process.argv = [process.execPath, entry];
  });
  afterEach(() => {
    process.argv = originalArgv;
    vi.clearAllMocks();
  });

  it('lets the newly installed CLI report connectors instead of the updating process', async () => {
    installedReports('2.0.0');
    statusExits(0);

    await reportInstalledConnectStatus('2.0.0');

    expect(execFile).toHaveBeenCalledWith(
      process.execPath,
      [entry, '--version'],
      expect.anything(),
      expect.any(Function),
    );
    expect(spawn).toHaveBeenCalledWith(process.execPath, [entry, 'connect', 'status'], {
      stdio: 'inherit',
    });
    expect(printConnectStatus).not.toHaveBeenCalled();
  });

  it('reports from this process when the entry does not run the installed version', async () => {
    installedReports('1.0.0');

    await reportInstalledConnectStatus('2.0.0');

    expect(spawn).not.toHaveBeenCalled();
    expect(printConnectStatus).toHaveBeenCalledWith({ installedVersion: '2.0.0', verbose: false });
  });

  it('reports from this process when the installed CLI cannot report', async () => {
    installedReports('2.0.0');
    statusExits(1);

    await reportInstalledConnectStatus('2.0.0');

    expect(printConnectStatus).toHaveBeenCalledWith({ installedVersion: '2.0.0', verbose: false });
  });

  it('forwards verbose diagnostics to the installed CLI', async () => {
    installedReports('2.0.0');
    statusExits(0);
    await reportInstalledConnectStatus('2.0.0', true);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [entry, 'connect', 'status', '--verbose'],
      {
        stdio: 'inherit',
      },
    );
  });
});

describe('fetchLatestVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    execFile.mockReset();
  });

  it('reads the dist-tag from the registry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '1.2.3' }));
    await expect(fetchLatestVersion('@lobehub/cli', 'latest')).resolves.toBe('1.2.3');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('falls back to npm view when the direct request cannot reach the registry', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    execFile.mockImplementation((_command, _args, _options, callback) => callback(null, '1.2.4\n'));
    await expect(fetchLatestVersion('@lobehub/cli', 'latest')).resolves.toBe('1.2.4');
    expect(execFile).toHaveBeenCalledWith(
      'npm',
      ['view', '@lobehub/cli@latest', 'version'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('reports the registry error when npm view fails too', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    execFile.mockImplementation((_command, _args, _options, callback) =>
      callback(new Error('npm missing'), ''),
    );
    await expect(fetchLatestVersion('@lobehub/cli', 'latest')).rejects.toThrow('fetch failed');
  });
});
