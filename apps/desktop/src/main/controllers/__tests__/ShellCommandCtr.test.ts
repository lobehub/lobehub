import { writeSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import CliCtr from '../CliCtr';
import ShellCommandCtr from '../ShellCommandCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock child_process for the shared package
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../CliCtr', () => ({
  default: class CliCtr {},
}));

const mockCliCtr = {
  runCliCommand: vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'cli output\n' }),
};

const mockApp = {
  getController: vi.fn((c: unknown) => (c === CliCtr ? mockCliCtr : undefined)),
} as unknown as App;

describe('ShellCommandCtr (thin wrapper)', () => {
  let ctr: ShellCommandCtr;
  let mockSpawn: any;
  let mockChildProcess: any;
  let mockProcessOutput: string;
  let listeners: Map<string, Set<(...args: any[]) => void>>;

  const emitChildProcess = (event: string, ...args: any[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockProcessOutput = '';
    listeners = new Map();

    const childProcessModule = await import('node:child_process');
    mockSpawn = vi.mocked(childProcessModule.spawn);

    mockChildProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      // ShellProcessManager registers and later removes child process listeners
      // while racing exit/error/timeout and waiting for close. Keep enough
      // EventEmitter semantics here so the test follows the real lifecycle.
      off: vi.fn((event: string, callback: (...args: any[]) => void) => {
        listeners.get(event)?.delete(callback);
        return mockChildProcess;
      }),
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(callback);
        listeners.set(event, eventListeners);
        return mockChildProcess;
      }),
      once: vi.fn((event: string, callback: (...args: any[]) => void) => {
        const onceCallback = (...args: any[]) => {
          listeners.get(event)?.delete(onceCallback);
          callback(...args);
        };
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(onceCallback);
        listeners.set(event, eventListeners);
        return mockChildProcess;
      }),
      kill: vi.fn(),
      exitCode: null,
    };

    mockSpawn.mockImplementation((_cmd: string, _args: string[], options: any) => {
      const outputFd = Array.isArray(options?.stdio) ? options.stdio[1] : undefined;
      if (typeof outputFd === 'number' && mockProcessOutput) {
        writeSync(outputFd, mockProcessOutput);
      }
      return mockChildProcess;
    });
    ctr = new ShellCommandCtr(mockApp);
  });

  it('should delegate handleRunCommand to shared runCommand', async () => {
    mockProcessOutput = 'output\n';
    setTimeout(() => {
      mockChildProcess.exitCode = 0;
      emitChildProcess('exit', 0);
      emitChildProcess('close', 0);
    }, 10);

    const result = await ctr.handleRunCommand({
      command: 'echo test',
      description: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('output');
  });

  it('should delegate handleGetCommandOutput to processManager', async () => {
    mockProcessOutput = 'bg output\n';

    const runResult = await ctr.handleRunCommand({
      command: 'test',
      run_in_background: true,
    });

    await new Promise((r) => setTimeout(r, 20));

    const result = await ctr.handleGetCommandOutput({
      shell_id: runResult.shell_id!,
      timeout: 0,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('bg output');
  });

  it('should delegate handleKillCommand to processManager', async () => {
    mockChildProcess.on.mockImplementation(() => mockChildProcess);
    mockChildProcess.once.mockImplementation(() => mockChildProcess);
    mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
    mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

    const runResult = await ctr.handleRunCommand({
      command: 'test',
      run_in_background: true,
    });

    const result = await ctr.handleKillCommand({
      shell_id: runResult.shell_id!,
    });

    expect(result.success).toBe(true);
    expect(mockChildProcess.kill).toHaveBeenCalled();
  });

  it('should route lh commands to CliCtr.runCliCommand', async () => {
    const result = await ctr.handleRunCommand({
      command: 'lh status --json',
      description: 'lh status',
    });

    expect(mockCliCtr.runCliCommand).toHaveBeenCalledWith('status --json');
    expect(result.success).toBe(true);
    expect(result.output).toContain('cli output');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('should route lobehub commands to CliCtr.runCliCommand', async () => {
    const result = await ctr.handleRunCommand({
      command: 'lobehub search test',
      description: 'lobehub search',
    });

    expect(mockCliCtr.runCliCommand).toHaveBeenCalledWith('search test');
    expect(result.success).toBe(true);
  });

  it('should return error for non-existent shell_id', async () => {
    const result = await ctr.handleGetCommandOutput({
      shell_id: 'non-existent',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
