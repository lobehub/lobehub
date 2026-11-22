import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import type * as os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Installers that leave a CLI off the running app's PATH, and the WSL fallback
// that must stay out of the way when Windows already has the agent. Mocks
// precede the module import because it captures `promisify(execFile)`.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'win32') };
});
vi.mock('node:child_process', () => ({ exec: vi.fn(), execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');
  return { ...actual, access: vi.fn(), readFile: vi.fn() };
});

const execFileMock = vi.mocked(childProcess.execFile);
const spawnMock = vi.mocked(childProcess.spawn);
const accessMock = vi.mocked(fsPromises.access);
const readFileMock = vi.mocked(fsPromises.readFile);

/**
 * Answer execFile by program name; anything unanswered fails like a missing binary.
 * The promisified callers read `{ stdout }`, the callback callers stringify it.
 */
const answerExecFile = (answer: (file: string, args: string[]) => string | undefined) => {
  execFileMock.mockImplementation(((file: string, args: any, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    const stdout = answer(file, args);
    if (stdout === undefined) callback(new Error(`not found: ${file}`), { stderr: '', stdout: '' });
    else callback(null, { stderr: '', stdout, toString: () => stdout });
    return {} as any;
  }) as any);
};

const existingPaths = (...paths: string[]) => {
  const known = new Set(paths.map((filePath) => filePath.toLowerCase()));
  accessMock.mockImplementation(async (filePath) => {
    if (!known.has(String(filePath).toLowerCase())) throw new Error('missing');
  });
};

const importModule = () => import('./resolveCliCommand');

describe('Windows install locations off PATH', () => {
  const localAppData = 'C:\\Users\\me\\AppData\\Local';
  const appData = 'C:\\Users\\me\\AppData\\Roaming';

  beforeEach(async () => {
    (await importModule()).invalidateLoginShellPathCache();
    execFileMock.mockReset();
    spawnMock.mockReset();
    readFileMock.mockReset();
    vi.stubEnv('PATH', 'C:\\Windows');
    vi.stubEnv('LOCALAPPDATA', localAppData);
    vi.stubEnv('APPDATA', appData);
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    // No WSL on this machine: wsl.exe can't be started.
    spawnMock.mockImplementation(() => {
      throw new Error('spawn wsl.exe ENOENT');
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("finds Cursor's launcher in %LOCALAPPDATA%\\cursor-agent and validates it via PowerShell", async () => {
    const launcher = path.win32.join(localAppData, 'cursor-agent', 'agent.cmd');
    const script = path.win32.join(localAppData, 'cursor-agent', 'agent.ps1');
    existingPaths(launcher, script);
    readFileMock.mockResolvedValue(
      '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1" %*\r\n',
    );
    answerExecFile((file, args) =>
      file.endsWith('powershell.exe') && args.includes(script) && args.at(-1) === '--help'
        ? 'Usage: agent [options] [command] [prompt...]\n\nStart the Cursor Agent'
        : undefined,
    );

    const { detectHeterogeneousCliCommand } = await importModule();

    await expect(detectHeterogeneousCliCommand('cursor', 'agent')).resolves.toMatchObject({
      available: true,
      path: launcher,
    });
  });

  it('finds a global npm install of the DeepSeek Harness CLI', async () => {
    const shim = path.win32.join(appData, 'npm', 'dsh.cmd');
    const entry = path.win32.join(
      appData,
      'npm',
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'bin',
      'dsh.js',
    );
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
    existingPaths(shim, entry, nodeExe);
    readFileMock.mockResolvedValue(
      '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@deepseek-ai\\dsh\\bin\\dsh.js" %*\r\n',
    );
    answerExecFile((file, args) => {
      if (file === 'where' && args[0] === 'node') return `${nodeExe}\r\n`;
      if (file === nodeExe && args.at(-1) === '--version') return '0.9.0\n';
      return undefined;
    });

    const { detectDshCommand } = await import('./dshAcpSession');

    await expect(detectDshCommand()).resolves.toMatchObject({ available: true, path: shim });
  });

  it('does not wake WSL when Windows already has the agent', async () => {
    const codex = 'C:\\tools\\codex.exe';
    existingPaths(codex);
    answerExecFile((file, args) => {
      if (file === 'where' && args[0] === 'codex') return `${codex}\r\n`;
      if (file === codex) return 'codex-cli 0.50.0';
      return undefined;
    });

    const { detectHeterogeneousCliCommand } = await importModule();

    await expect(detectHeterogeneousCliCommand('codex', 'codex')).resolves.toMatchObject({
      available: true,
      path: codex,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
