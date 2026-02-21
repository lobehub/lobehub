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

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock crypto
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-123'),
}));

const mockApp = {} as unknown as App;

describe('ShellCommandCtr', () => {
  let shellCommandCtr: ShellCommandCtr;
  let mockSpawn: any;
  let mockChildProcess: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocks
    const childProcessModule = await import('node:child_process');
    mockSpawn = vi.mocked(childProcessModule.spawn);

    // Create mock child process
    mockChildProcess = {
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: null,
    };

    mockSpawn.mockReturnValue(mockChildProcess);

    shellCommandCtr = new ShellCommandCtr(mockApp);
  });

  describe('handleRunCommand', () => {
    describe('synchronous mode', () => {
      it('should execute command successfully', async () => {
        let exitCallback: (code: number) => void;
        let stdoutCallback: (data: Buffer) => void;

        mockChildProcess.on.mockImplementation((event: string, callback: any) => {
          if (event === 'exit') {
            exitCallback = callback;
            // Simulate successful exit
            setTimeout(() => exitCallback(0), 10);
          }
          return mockChildProcess;
        });

        mockChildProcess.stdout.on.mockImplementation((event: string, callback: any) => {
          if (event === 'data') {
            stdoutCallback = callback;
            // Simulate output
            setTimeout(() => stdoutCallback(Buffer.from('test output\n')), 5);
          }
          return mockChildProcess.stdout;
        });

        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        const result = await shellCommandCtr.handleRunCommand({
          command: 'echo "test"',
          description: 'test command',
        });

        expect(result.success).toBe(true);
        expect(result.stdout).toBe('test output\n');
        expect(result.exit_code).toBe(0);
      });

      it('should handle command timeout', async () => {
        mockChildProcess.on.mockImplementation(() => mockChildProcess);
        mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        const result = await shellCommandCtr.handleRunCommand({
          command: 'sleep 10',
          description: 'long running command',
          timeout: 100,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
        expect(mockChildProcess.kill).toHaveBeenCalled();
      });

      it('should handle command execution error', async () => {
        let errorCallback: (error: Error) => void;

        mockChildProcess.on.mockImplementation((event: string, callback: any) => {
          if (event === 'error') {
            errorCallback = callback;
            setTimeout(() => errorCallback(new Error('Command not found')), 10);
          }
          return mockChildProcess;
        });

        mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        const result = await shellCommandCtr.handleRunCommand({
          command: 'invalid-command',
          description: 'invalid command',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Command not found');
      });

      it('should handle non-zero exit code', async () => {
        let exitCallback: (code: number) => void;

        mockChildProcess.on.mockImplementation((event: string, callback: any) => {
          if (event === 'exit') {
            exitCallback = callback;
            setTimeout(() => exitCallback(1), 10);
          }
          return mockChildProcess;
        });

        mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        const result = await shellCommandCtr.handleRunCommand({
          command: 'exit 1',
          description: 'failing command',
        });

        expect(result.success).toBe(false);
        expect(result.exit_code).toBe(1);
      });

      it('should capture stderr output', async () => {
        let exitCallback: (code: number) => void;
        let stderrCallback: (data: Buffer) => void;

        mockChildProcess.on.mockImplementation((event: string, callback: any) => {
          if (event === 'exit') {
            exitCallback = callback;
            setTimeout(() => exitCallback(1), 10);
          }
          return mockChildProcess;
        });

        mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
        mockChildProcess.stderr.on.mockImplementation((event: string, callback: any) => {
          if (event === 'data') {
            stderrCallback = callback;
            setTimeout(() => stderrCallback(Buffer.from('error message\n')), 5);
          }
          return mockChildProcess.stderr;
        });

        const result = await shellCommandCtr.handleRunCommand({
          command: 'command-with-error',
          description: 'command with stderr',
        });

        expect(result.stderr).toBe('error message\n');
      });

      it('should strip ANSI escape codes from output', async () => {
        let exitCallback: (code: number) => void;
        let stdoutCallback: (data: Buffer) => void;
        let stderrCallback: (data: Buffer) => void;

        mockChildProcess.on.mockImplementation((event: string, callback: any) => {
          if (event === 'exit') {
            exitCallback = callback;
            setTimeout(() => exitCallback(0), 10);
          }
          return mockChildProcess;
        });

        mockChildProcess.stdout.on.mockImplementation((event: string, callback: any) => {
          if (event === 'data') {
            stdoutCallback = callback;
            // Simulate output with ANSI color codes
            setTimeout(
              () =>
                stdoutCallback(
                  Buffer.from(
                    '\x1b[38;5;250m███████╗\x1b[0m\n\x1b[1;32mSuccess\x1b[0m\n\x1b[31mError\x1b[0m',
                  ),
                ),
              5,
            );
          }
          return mockChildProcess.stdout;
        });

        mockChildProcess.stderr.on.mockImplementation((event: string, callback: any) => {
          if (event === 'data') {
            stderrCallback = callback;
            setTimeout(
              () => stderrCallback(Buffer.from('\x1b[33mwarning:\x1b[0m something happened')),
              5,
            );
          }
          return mockChildProcess.stderr;
        });

        const result = await shellCommandCtr.handleRunCommand({
          command: 'npx skills find react',
          description: 'search skills',
        });

        expect(result.success).toBe(true);
        // ANSI codes should be stripped
        expect(result.stdout).not.toContain('\x1b[');
        expect(result.stdout).toContain('███████╗');
        expect(result.stdout).toContain('Success');
        expect(result.stdout).toContain('Error');
        expect(result.stderr).not.toContain('\x1b[');
        expect(result.stderr).toContain('warning: something happened');
      });

      it('should truncate long output to prevent context explosion', async () => {
        let exitCallback: (code: number) => void;
        let stdoutCallback: (data: Buffer) => void;

        mockChildProcess.on.mockImplementation((event: string, callback: any) => {
          if (event === 'exit') {
            exitCallback = callback;
            setTimeout(() => exitCallback(0), 10);
          }
          return mockChildProcess;
        });

        mockChildProcess.stdout.on.mockImplementation((event: string, callback: any) => {
          if (event === 'data') {
            stdoutCallback = callback;
            // Simulate very long output (100k characters, exceeding 80k MAX_OUTPUT_LENGTH)
            const longOutput = 'x'.repeat(100_000);
            setTimeout(() => stdoutCallback(Buffer.from(longOutput)), 5);
          }
          return mockChildProcess.stdout;
        });

        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        const result = await shellCommandCtr.handleRunCommand({
          command: 'command-with-long-output',
          description: 'long output command',
        });

        expect(result.success).toBe(true);
        // Output should be truncated to 80k + truncation message
        expect(result.stdout!.length).toBeLessThan(100_000);
        expect(result.stdout).toContain('truncated');
        expect(result.stdout).toContain('more characters');
      });

      it('should enforce timeout limits', async () => {
        mockChildProcess.on.mockImplementation(() => mockChildProcess);
        mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        // Test minimum timeout
        const minResult = await shellCommandCtr.handleRunCommand({
          command: 'sleep 5',
          timeout: 500, // Below 1000ms minimum
        });

        expect(minResult.success).toBe(false);
        expect(minResult.error).toContain('1000ms'); // Should use 1000ms minimum
      });
    });

    describe('background mode', () => {
      it('should start command in background', async () => {
        mockChildProcess.on.mockImplementation(() => mockChildProcess);
        mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        const result = await shellCommandCtr.handleRunCommand({
          command: 'long-running-task',
          description: 'background task',
          run_in_background: true,
        });

        expect(result.success).toBe(true);
        expect(result.shell_id).toBe('test-uuid-123');
      });

      it('should use correct shell on Windows', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32' });

        mockChildProcess.on.mockImplementation(() => mockChildProcess);
        mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        await shellCommandCtr.handleRunCommand({
          command: 'dir',
          description: 'windows command',
          run_in_background: true,
        });

        expect(mockSpawn).toHaveBeenCalledWith('cmd.exe', ['/c', 'dir'], expect.any(Object));

        Object.defineProperty(process, 'platform', { value: originalPlatform });
      });

      it('should use correct shell on Unix', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'darwin' });

        mockChildProcess.on.mockImplementation(() => mockChildProcess);
        mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
        mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

        await shellCommandCtr.handleRunCommand({
          command: 'ls',
          description: 'unix command',
          run_in_background: true,
        });

        expect(mockSpawn).toHaveBeenCalledWith('/bin/sh', ['-c', 'ls'], expect.any(Object));

        Object.defineProperty(process, 'platform', { value: originalPlatform });
      });
    });
  });

  describe('handleGetCommandOutput', () => {
    beforeEach(async () => {
      mockChildProcess.on.mockImplementation(() => mockChildProcess);
      mockChildProcess.stdout.on.mockImplementation((event: string, callback: any) => {
        if (event === 'data') {
          // Simulate some output
          setTimeout(() => callback(Buffer.from('line 1\n')), 5);
          setTimeout(() => callback(Buffer.from('line 2\n')), 10);
        }
        return mockChildProcess.stdout;
      });
      mockChildProcess.stderr.on.mockImplementation((event: string, callback: any) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('error line\n')), 7);
        }
        return mockChildProcess.stderr;
      });

      // Start a background process first
      await shellCommandCtr.handleRunCommand({
        command: 'test-command',
        run_in_background: true,
      });
    });

    it('should retrieve command output', async () => {
      // Wait for output to be captured
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('line 1');
      expect(result.stderr).toContain('error line');
    });

    it('should return error for non-existent shell_id', async () => {
      const result = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'non-existent-id',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should filter output with regex', async () => {
      // Wait for output to be captured
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
        filter: 'line 1',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('line 1');
      expect(result.output).not.toContain('line 2');
    });

    it('should only return new output since last read', async () => {
      // Wait for initial output
      await new Promise((resolve) => setTimeout(resolve, 20));

      // First read
      const firstResult = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });

      expect(firstResult.stdout).toContain('line 1');

      // Second read should return empty (no new output)
      const secondResult = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });

      expect(secondResult.stdout).toBe('');
      expect(secondResult.stderr).toBe('');
    });

    it('should handle invalid regex filter gracefully', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
        filter: '[invalid(regex',
      });

      expect(result.success).toBe(true);
      // Should return unfiltered output when filter is invalid
    });

    it('should report running status correctly', async () => {
      mockChildProcess.exitCode = null;

      const runningResult = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });

      expect(runningResult.running).toBe(true);

      // Simulate process exit
      mockChildProcess.exitCode = 0;

      const exitedResult = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });

      expect(exitedResult.running).toBe(false);
    });

    it('should track stdout and stderr offsets separately when streaming output', async () => {
      // Create a new background process with manual control over stdout/stderr
      let stdoutCallback: (data: Buffer) => void;
      let stderrCallback: (data: Buffer) => void;

      mockChildProcess.stdout.on.mockImplementation((event: string, callback: any) => {
        if (event === 'data') {
          stdoutCallback = callback;
        }
        return mockChildProcess.stdout;
      });

      mockChildProcess.stderr.on.mockImplementation((event: string, callback: any) => {
        if (event === 'data') {
          stderrCallback = callback;
        }
        return mockChildProcess.stderr;
      });

      // Start a new background process
      await shellCommandCtr.handleRunCommand({
        command: 'test-interleaved',
        run_in_background: true,
      });

      // Simulate stderr output first
      stderrCallback(Buffer.from('error 1\n'));
      await new Promise((resolve) => setTimeout(resolve, 5));

      // First read - should get stderr
      const firstRead = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });
      expect(firstRead.stderr).toBe('error 1\n');
      expect(firstRead.stdout).toBe('');

      // Simulate stdout output after stderr
      stdoutCallback(Buffer.from('output 1\n'));
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Second read - should get stdout without losing data
      const secondRead = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });
      expect(secondRead.stdout).toBe('output 1\n');
      expect(secondRead.stderr).toBe('');

      // Simulate more stderr
      stderrCallback(Buffer.from('error 2\n'));
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Third read - should get new stderr
      const thirdRead = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });
      expect(thirdRead.stderr).toBe('error 2\n');
      expect(thirdRead.stdout).toBe('');

      // Simulate more stdout
      stdoutCallback(Buffer.from('output 2\n'));
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Fourth read - should get new stdout
      const fourthRead = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });
      expect(fourthRead.stdout).toBe('output 2\n');
      expect(fourthRead.stderr).toBe('');
    });
  });

  describe('handleKillCommand', () => {
    beforeEach(async () => {
      mockChildProcess.on.mockImplementation(() => mockChildProcess);
      mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
      mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

      // Start a background process
      await shellCommandCtr.handleRunCommand({
        command: 'test-command',
        run_in_background: true,
      });
    });

    it('should kill command successfully', async () => {
      const result = await shellCommandCtr.handleKillCommand({
        shell_id: 'test-uuid-123',
      });

      expect(result.success).toBe(true);
      expect(mockChildProcess.kill).toHaveBeenCalled();
    });

    it('should return error for non-existent shell_id', async () => {
      const result = await shellCommandCtr.handleKillCommand({
        shell_id: 'non-existent-id',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should remove process from map after killing', async () => {
      await shellCommandCtr.handleKillCommand({
        shell_id: 'test-uuid-123',
      });

      // Try to get output from killed process
      const outputResult = await shellCommandCtr.handleGetCommandOutput({
        shell_id: 'test-uuid-123',
      });

      expect(outputResult.success).toBe(false);
      expect(outputResult.error).toContain('not found');
    });

    it('should handle kill error gracefully', async () => {
      mockChildProcess.kill.mockImplementation(() => {
        throw new Error('Kill failed');
      });

      const result = await shellCommandCtr.handleKillCommand({
        shell_id: 'test-uuid-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Kill failed');
    });
  });
});
