import * as childProcess from 'node:child_process';
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
  };
});

const platformMock = vi.mocked(os.platform);
const execFileMock = vi.mocked(childProcess.execFile);
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

const existingPaths = (...paths: string[]) => {
  const normalizedPaths = new Set(paths.map((filePath) => filePath.toLowerCase()));
  accessMock.mockImplementation(async (filePath) => {
    if (normalizedPaths.has(String(filePath).toLowerCase())) return;
    throw new Error(`missing: ${String(filePath)}`);
  });
};

describe('cliSpawn', () => {
  beforeEach(() => {
    platformMock.mockReturnValue('linux');
    execFileMock.mockReset();
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

  it('prefers a Windows executable returned by where', async () => {
    platformMock.mockReturnValue('win32');
    callExecFile(
      ['C:\\Users\\Hanam\\AppData\\Roaming\\npm\\gemini.cmd', 'C:\\Tools\\gemini.exe'].join('\r\n'),
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan('gemini', ['--version'])).resolves.toEqual({
      args: ['--version'],
      command: 'C:\\Tools\\gemini.exe',
    });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('resolves Windows npm shell shim to a package executable', async () => {
    platformMock.mockReturnValue('win32');
    const shimPath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude';
    const exePath =
      'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    callExecFile([shimPath, `${shimPath}.cmd`].join('\r\n'));
    existingPaths(shimPath, exePath);
    readFileMock.mockResolvedValue(
      'exec "$basedir/node_modules/@anthropic-ai/claude-code/bin/claude.exe"   "$@"\n',
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan('claude', ['--version'])).resolves.toEqual({
      args: ['--version'],
      command: exePath,
    });
  });

  it('resolves Windows npm .cmd shim to a package executable when configured directly', async () => {
    platformMock.mockReturnValue('win32');
    const shimPath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\claude.cmd';
    const exePath =
      'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    existingPaths(shimPath, exePath);
    readFileMock.mockResolvedValue(
      '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan(shimPath, ['--version'])).resolves.toEqual({
      args: ['--version'],
      command: exePath,
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('resolves a .cmd npm shim that invokes node.exe plus a JS bin', async () => {
    platformMock.mockReturnValue('win32');
    const shimPath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\gemini.cmd';
    const nodePath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node.exe';
    const scriptPath =
      'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js';
    existingPaths(shimPath, nodePath, scriptPath);
    readFileMock.mockResolvedValue(
      '@ECHO off\r\n"%dp0%\\node.exe" "%dp0%\\node_modules\\@google\\gemini-cli\\dist\\index.js" %*\r\n',
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan(shimPath, ['--version'])).resolves.toEqual({
      args: [scriptPath, '--version'],
      command: nodePath,
    });
  });

  it('resolves an extensionless npm shell shim that invokes node.exe plus a JS bin', async () => {
    platformMock.mockReturnValue('win32');
    const shimPath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\kimi';
    const nodePath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node.exe';
    const scriptPath =
      'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node_modules\\kimi-cli\\bin\\kimi.js';
    callExecFile([shimPath, `${shimPath}.cmd`].join('\r\n'));
    existingPaths(shimPath, nodePath, scriptPath);
    readFileMock.mockResolvedValue(
      'exec "$basedir/node.exe" "$basedir/node_modules/kimi-cli/bin/kimi.js" "$@"\n',
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan('kimi', ['chat', '--json'])).resolves.toEqual({
      args: [scriptPath, 'chat', '--json'],
      command: nodePath,
    });
  });

  it('uses the node executable from PATH when a shim invokes bare node plus a JS bin', async () => {
    platformMock.mockReturnValue('win32');
    const shimPath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\example-cli.cmd';
    const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
    const scriptPath =
      'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node_modules\\example-cli\\bin\\cli.js';
    existingPaths(shimPath, scriptPath);
    callExecFile(`${nodePath}\r\n`);
    readFileMock.mockResolvedValue('node "%dp0%\\node_modules\\example-cli\\bin\\cli.js" %*\r\n');

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan(shimPath, ['--help'])).resolves.toEqual({
      args: [scriptPath, '--help'],
      command: nodePath,
    });
  });

  it('resolves the npm generated %_prog% .cmd shim form used by Codex and Gemini', async () => {
    platformMock.mockReturnValue('win32');
    const shimPath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\codex.cmd';
    const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
    const scriptPath =
      'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
    existingPaths(shimPath, scriptPath);
    callExecFile(`${nodePath}\r\n`);
    readFileMock.mockResolvedValue(
      [
        '@ECHO off',
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ') ELSE (',
        '  SET "_prog=node"',
        ')',
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
      ].join('\r\n'),
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan(shimPath, ['--version'])).resolves.toEqual({
      args: [scriptPath, '--version'],
      command: nodePath,
    });
  });

  it('falls back to the original command and args when a JS bin target is missing', async () => {
    platformMock.mockReturnValue('win32');
    const shimPath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\gemini.cmd';
    existingPaths(shimPath, 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\node.exe');
    readFileMock.mockResolvedValue(
      '"%dp0%\\node.exe" "%dp0%\\node_modules\\@google\\gemini-cli\\dist\\index.js" %*\r\n',
    );

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan(shimPath, ['--version'])).resolves.toEqual({
      args: ['--version'],
      command: shimPath,
    });
  });

  it('falls back to the original command and args when shim content is unsupported', async () => {
    platformMock.mockReturnValue('win32');
    const shimPath = 'C:\\Users\\Hanam\\AppData\\Roaming\\npm\\unknown.cmd';
    existingPaths(shimPath);
    readFileMock.mockResolvedValue('@ECHO off\r\nset SOME_VAR=1\r\n');

    const { resolveCliSpawnPlan } = await import('./cliSpawn');
    await expect(resolveCliSpawnPlan(shimPath, ['--version'])).resolves.toEqual({
      args: ['--version'],
      command: shimPath,
    });
  });
});
