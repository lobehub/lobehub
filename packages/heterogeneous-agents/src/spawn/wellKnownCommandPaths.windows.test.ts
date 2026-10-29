import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWellKnownCommandPaths } from './wellKnownCommandPaths';

const platformMock = vi.hoisted(() => vi.fn());

vi.mock('node:os', () => ({ homedir: vi.fn(), platform: platformMock }));

vi.mock('node:child_process', () => ({ exec: vi.fn(), execFile: vi.fn() }));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');
  return { ...actual, access: vi.fn(), readFile: vi.fn() };
});

const execFileMock = vi.mocked(childProcess.execFile);
const accessMock = vi.mocked(fsPromises.access);
const readFileMock = vi.mocked(fsPromises.readFile);

const originalLocalAppData = process.env.LOCALAPPDATA;

describe('getWellKnownCommandPaths on Windows', () => {
  beforeEach(() => {
    platformMock.mockReturnValue('win32');
    process.env.LOCALAPPDATA = 'C:\\Users\\x\\AppData\\Local';
    execFileMock.mockReset();
    accessMock.mockReset();
    readFileMock.mockReset();
  });

  afterEach(() => {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  });

  it('finds the official Cursor CLI launchers when PATH is missing them', () => {
    expect(getWellKnownCommandPaths('cursor')).toEqual([
      path.win32.join(process.env.LOCALAPPDATA!, 'cursor-agent', 'agent.cmd'),
      path.win32.join(process.env.LOCALAPPDATA!, 'cursor-agent', 'cursor-agent.cmd'),
    ]);
  });

  it('validates a Cursor launcher under a Windows path containing shell metacharacters', async () => {
    const originalPath = process.env.PATH;
    const localAppData = 'C:\\Profiles\\R&D\\AppData\\Local';
    const launcherPath = path.win32.join(localAppData, 'cursor-agent', 'agent.cmd');
    const executablePath = path.win32.join(localAppData, 'cursor-agent', 'agent.exe');
    process.env.LOCALAPPDATA = localAppData;
    process.env.PATH = 'C:\\Windows';

    accessMock.mockImplementation(async (filePath) => {
      if (![launcherPath, executablePath].includes(String(filePath))) {
        throw new Error(`missing: ${filePath}`);
      }
    });
    readFileMock.mockResolvedValue(`@"%~dp0\\agent.exe" %*\r\n`);
    execFileMock.mockImplementation(((file: string, args: any, _options: any, callback: any) => {
      if (file === 'where' || file === 'reg') {
        callback(new Error('not found'), { stderr: '', stdout: '' });
      } else if (file === executablePath) {
        callback(null, {
          stderr: '',
          stdout: 'Usage: agent [options] [command] [prompt...]\nStart the Cursor Agent',
        });
      } else {
        callback(new Error(`unexpected execFile: ${file} ${JSON.stringify(args)}`), {
          stderr: '',
          stdout: '',
        });
      }
      return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);

    try {
      const { detectHeterogeneousCliCommand } = await import('./resolveCliCommand');

      await expect(detectHeterogeneousCliCommand('cursor', 'agent')).resolves.toMatchObject({
        available: true,
        path: launcherPath,
      });
      expect(execFileMock.mock.calls.some(([file]) => file === executablePath)).toBe(true);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });
});
