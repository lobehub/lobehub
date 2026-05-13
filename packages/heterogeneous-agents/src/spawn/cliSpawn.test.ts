import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => actual.platform()) };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');
  return {
    ...actual,
    access: vi.fn(),
    readFile: vi.fn(),
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return {
    ...actual,
    execFile: vi.fn(),
    spawn: vi.fn(() => new EventEmitter()),
  };
});

const platformMock = vi.mocked(os.platform);
const execFileMock = vi.mocked(childProcess.execFile);
const spawnMock = vi.mocked(childProcess.spawn);
const accessMock = vi.mocked(fsPromises.access);
const readFileMock = vi.mocked(fsPromises.readFile);

const callExecFile = (stdout: string) => {
  execFileMock.mockImplementationOnce(((...args: unknown[]) => {
    const callback = [...args].reverse().find((arg) => typeof arg === 'function') as
      | ((error: Error | null, stdout: string) => void)
      | undefined;
    callback?.(null, stdout);
    return {} as childProcess.ChildProcess;
  }) as typeof childProcess.execFile);
};

describe('cliSpawn', () => {
  beforeEach(() => {
    platformMock.mockReturnValue('linux');
    execFileMock.mockReset();
    spawnMock.mockClear();
    accessMock.mockReset();
    readFileMock.mockReset();
  });

  it('keeps non-Windows commands unchanged', async () => {
    platformMock.mockReturnValue('darwin');
    const { resolveCliSpawnPlan } = await import('./cliSpawn');

    await expect(resolveCliSpawnPlan('claude', ['--version'])).resolves.toEqual({
      args: ['--version'],
      command: 'claude',
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('resolves Windows npm shell shim to the package claude.exe', async () => {
    platformMock.mockReturnValue('win32');
    callExecFile(
      [
        'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude',
        'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude.cmd',
      ].join('\r\n'),
    );
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      'exec "$basedir/node_modules/@anthropic-ai/claude-code/bin/claude.exe"   "$@"\n',
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan('claude', ['--version'])).resolves.toEqual({
      args: ['--version'],
      command:
        'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
    });
  });

  it('resolves Windows npm .cmd shim to the package claude.exe when configured directly', async () => {
    platformMock.mockReturnValue('win32');
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(
      resolveCliSpawnPlan('C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude.cmd', ['--version']),
    ).resolves.toEqual({
      args: ['--version'],
      command:
        'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
    });
  });

  it('spawns the resolved command', async () => {
    platformMock.mockReturnValue('win32');
    callExecFile('C:\\Tools\\claude.exe\r\n');
    const options = { cwd: 'C:\\repo', stdio: ['pipe', 'pipe', 'pipe'] } as any;

    const { spawnCli } = await import('./cliSpawn');
    await spawnCli('claude', ['-p'], options);

    expect(spawnMock).toHaveBeenCalledWith('C:\\Tools\\claude.exe', ['-p'], options);
  });
});
