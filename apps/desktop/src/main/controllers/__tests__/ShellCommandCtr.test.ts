import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

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
  spawn: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-123'),
}));

const mockApp = {} as unknown as App;

describe('ShellCommandCtr (thin wrapper)', () => {
  let ctr: ShellCommandCtr;
  let mockSpawn: any;
  let mockChildProcess: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const childProcessModule = await import('node:child_process');
    mockSpawn = vi.mocked(childProcessModule.spawn);

    mockChildProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: null,
    };

    mockSpawn.mockReturnValue(mockChildProcess);
    ctr = new ShellCommandCtr(mockApp);
  });

  it('should delegate handleRunCommand to shared runCommand', async () => {
    mockChildProcess.on.mockImplementation((event: string, callback: any) => {
      if (event === 'exit') setTimeout(() => callback(0), 10);
      return mockChildProcess;
    });
    mockChildProcess.stdout.on.mockImplementation((event: string, callback: any) => {
      if (event === 'data') setTimeout(() => callback(Buffer.from('output\n')), 5);
      return mockChildProcess.stdout;
    });
    mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

    const result = await ctr.handleRunCommand({
      command: 'echo test',
      description: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('output');
  });

  it('should delegate handleGetCommandOutput to processManager', async () => {
    mockChildProcess.on.mockImplementation(() => mockChildProcess);
    mockChildProcess.stdout.on.mockImplementation((event: string, callback: any) => {
      if (event === 'data') setTimeout(() => callback(Buffer.from('bg output\n')), 5);
      return mockChildProcess.stdout;
    });
    mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

    await ctr.handleRunCommand({
      command: 'test',
      run_in_background: true,
    });

    await new Promise((r) => setTimeout(r, 20));

    const result = await ctr.handleGetCommandOutput({
      shell_id: 'test-uuid-123',
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('bg output');
  });

  it('should delegate handleKillCommand to processManager', async () => {
    mockChildProcess.on.mockImplementation(() => mockChildProcess);
    mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
    mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

    await ctr.handleRunCommand({
      command: 'test',
      run_in_background: true,
    });

    const result = await ctr.handleKillCommand({
      shell_id: 'test-uuid-123',
    });

    expect(result.success).toBe(true);
    expect(mockChildProcess.kill).toHaveBeenCalled();
  });

  it('should return error for non-existent shell_id', async () => {
    const result = await ctr.handleGetCommandOutput({
      shell_id: 'non-existent',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
