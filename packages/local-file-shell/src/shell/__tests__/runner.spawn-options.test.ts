import type * as ChildProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellProcessManager } from '../process-manager';
import { runCommand } from '../runner';
import { resetShellDetectionCache } from '../utils';

const spawnSpy = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  spawnSpy.mockImplementation(actual.spawn);
  return { ...actual, spawn: spawnSpy };
});

describe('runCommand spawn options', () => {
  const realPlatform = process.platform;
  let processManager: ShellProcessManager;
  let tmpDir: string;

  beforeEach(() => {
    spawnSpy.mockClear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobehub-shell-spawn-options-'));
    processManager = new ShellProcessManager(tmpDir);
  });

  afterEach(() => {
    processManager.cleanupAll();
    fs.rmSync(tmpDir, { force: true, recursive: true });
    Object.defineProperty(process, 'platform', { configurable: true, value: realPlatform });
    resetShellDetectionCache();
    vi.restoreAllMocks();
  });

  it('should hide the console window spawned for the shell on Windows', async () => {
    const result = await runCommand({ command: 'echo hidden' }, { processManager });

    expect(result.success).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0][2]).toMatchObject({ windowsHide: true });
  });

  it('should report an inaccessible working directory before spawning a shell', async () => {
    const cwd = path.join(tmpDir, 'renamed-workspace');

    const result = await runCommand({ command: 'echo hidden', cwd }, { processManager });

    expect(result).toEqual({
      error: expect.stringContaining(`Working directory is not accessible: ${cwd}`),
      success: false,
    });
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('should retry once with the next Windows shell after a spawn ENOENT', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    const originalPath = process.env.PATH;
    const originalSystemRoot = process.env.SystemRoot;
    const pwshDir = '/fake/tools/pwsh';
    const pwshPath = path.join(pwshDir, 'pwsh.exe');
    const powershellPath = path.join(
      'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    process.env.PATH = pwshDir;
    process.env.SystemRoot = 'C:\\Windows';
    vi.spyOn(fs.promises, 'lstat').mockImplementation(async (candidate) => {
      if ([pwshPath, powershellPath].includes(candidate.toString())) return {} as fs.Stats;
      throw new Error('ENOENT');
    });

    const failed = new EventEmitter() as ChildProcess.ChildProcess;
    Object.assign(failed, { exitCode: null, kill: vi.fn(), pid: undefined, signalCode: null });
    const succeeded = new EventEmitter() as ChildProcess.ChildProcess;
    Object.assign(succeeded, { exitCode: null, kill: vi.fn(), pid: undefined, signalCode: null });
    spawnSpy
      .mockImplementationOnce(() => {
        queueMicrotask(() => {
          failed.emit('error', new Error('spawn pwsh.exe ENOENT'));
          failed.emit('close', 1);
        });
        return failed;
      })
      .mockImplementationOnce(() => {
        queueMicrotask(() => {
          succeeded.emit('exit', 0);
          succeeded.emit('close', 0);
        });
        return succeeded;
      });

    try {
      const result = await runCommand({ command: 'echo recovered' }, { processManager });

      expect(result.success).toBe(true);
      expect(result.exit_code).toBe(0);
      expect(spawnSpy).toHaveBeenCalledTimes(2);
      expect(spawnSpy.mock.calls[0][0]).toBe(pwshPath);
      expect(spawnSpy.mock.calls[1][0]).toBe(powershellPath);
    } finally {
      process.env.PATH = originalPath;
      process.env.SystemRoot = originalSystemRoot;
    }
  });
});
