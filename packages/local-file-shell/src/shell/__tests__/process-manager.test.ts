import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ShellProcess, ShellProcessManager } from '../process-manager';

function createMockProcess(exitCode: number | null = null): ChildProcess {
  const process = new EventEmitter() as ChildProcess;
  // Node types expose `exitCode` as readonly; make the test double writable so
  // we can simulate the child process exiting.
  Object.defineProperty(process, 'exitCode', {
    configurable: true,
    value: exitCode,
    writable: true,
  });
  process.kill = vi.fn() as unknown as ChildProcess['kill'];
  return process;
}

function createShellProcess(process: ChildProcess): ShellProcess {
  return {
    exitCode: process.exitCode,
    lastReadStderr: 0,
    lastReadStdout: 0,
    process,
    stderr: [],
    stdout: [],
  };
}

describe('ShellProcessManager', () => {
  let manager: ShellProcessManager;

  beforeEach(() => {
    manager = new ShellProcessManager();
  });

  describe('getOutput', () => {
    it('should return error for non-existent shell_id', async () => {
      const result = await manager.getOutput({ shell_id: 'non-existent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should retrieve stdout and stderr', async () => {
      const process = createMockProcess();
      manager.register('test-1', {
        ...createShellProcess(process),
        stderr: ['error line\n'],
        stdout: ['line 1\n', 'line 2\n'],
      });

      const result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('line 1');
      expect(result.stdout).toContain('line 2');
      expect(result.stderr).toContain('error line');
      expect(result.exit_code).toBeUndefined();
    });

    it('should return only new buffered output on repeated reads', async () => {
      const process = createMockProcess();
      const shellProcess = {
        ...createShellProcess(process),
        stdout: ['first\n'],
      };
      manager.register('test-1', shellProcess);

      const first = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(first.stdout).toContain('first');

      const second = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(second.stdout).toBe('');

      shellProcess.stdout.push('second\n');
      const third = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(third.stdout).toBe('second\n');
    });

    it('should return the current output snapshot when observation timeout elapses', async () => {
      vi.useFakeTimers();
      try {
        const process = createMockProcess();
        const shellProcess = createShellProcess(process);
        manager.register('test-1', shellProcess);
        let resolved = false;

        const pending = manager.getOutput({ shell_id: 'test-1', timeout: 100 }).then((result) => {
          resolved = true;
          return result;
        });

        setTimeout(() => {
          shellProcess.stdout.push('delayed\n');
        }, 20);

        await vi.advanceTimersByTimeAsync(20);
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(80);
        const result = await pending;
        expect(result.stdout).toContain('delayed');
        expect(result.exit_code).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should wait up to the default observation timeout when timeout is omitted', async () => {
      vi.useFakeTimers();
      try {
        const process = createMockProcess();
        const shellProcess = createShellProcess(process);
        manager.register('test-1', shellProcess);
        let resolved = false;

        const pending = manager.getOutput({ shell_id: 'test-1' }).then((result) => {
          resolved = true;
          return result;
        });

        await vi.advanceTimersByTimeAsync(29_999);
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        const result = await pending;
        expect(result.success).toBe(true);
        expect(result.exit_code).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should return done when process exits before new output', async () => {
      const process = createMockProcess();
      manager.register('test-1', createShellProcess(process));

      const pending = manager.getOutput({ shell_id: 'test-1', timeout: 100 });

      setTimeout(() => {
        (process as { exitCode: number | null }).exitCode = 0;
        process.emit('exit', 0);
      }, 20);

      const result = await pending;
      expect(result.exit_code).toBe(0);
    });

    it('should filter output with regex', async () => {
      const process = createMockProcess();
      manager.register('test-1', {
        ...createShellProcess(process),
        stdout: ['line 1\nline 2\nline 3\n'],
      });

      const result = await manager.getOutput({ filter: 'line 1', shell_id: 'test-1', timeout: 0 });

      expect(result.success).toBe(true);
      expect(result.output).toContain('line 1');
      expect(result.output).not.toContain('line 2');
    });

    it('should handle invalid regex filter gracefully', async () => {
      const process = createMockProcess();
      manager.register('test-1', { ...createShellProcess(process), stdout: ['output\n'] });

      const result = await manager.getOutput({
        filter: '[invalid(regex',
        shell_id: 'test-1',
        timeout: 0,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('output');
    });

    it('should reflect completion via exit_code', async () => {
      const process = createMockProcess();
      manager.register('test-1', createShellProcess(process));

      let result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(result.exit_code).toBeUndefined();

      (process as { exitCode: number | null }).exitCode = 0;

      result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(result.exit_code).toBe(0);
    });

    it('should report elapsed duration while the process is still running', async () => {
      vi.useFakeTimers();
      try {
        const process = createMockProcess();
        manager.register('test-1', createShellProcess(process));

        await vi.advanceTimersByTimeAsync(42_000);

        const result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
        expect(result.exit_code).toBeUndefined();
        expect(result.duration_ms).toBe(42_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should keep the final duration after the process exits', async () => {
      vi.useFakeTimers();
      try {
        const process = createMockProcess();
        manager.register('test-1', createShellProcess(process));

        await vi.advanceTimersByTimeAsync(2500);
        (process as { exitCode: number | null }).exitCode = 0;
        process.emit('exit', 0);
        await vi.advanceTimersByTimeAsync(7500);

        const result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
        expect(result.exit_code).toBe(0);
        expect(result.duration_ms).toBe(2500);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should retain completed output after the process exits', async () => {
      const process = createMockProcess();
      manager.register('test-1', {
        ...createShellProcess(process),
        stdout: ['done\n'],
      });

      (process as { exitCode: number | null }).exitCode = 0;

      const result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(result.success).toBe(true);
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toContain('done');
    });
  });

  describe('kill', () => {
    it('should kill process successfully', () => {
      const process = createMockProcess();
      manager.register('test-1', createShellProcess(process));

      const result = manager.kill('test-1');

      expect(result.success).toBe(true);
      expect(process.kill).toHaveBeenCalled();
    });

    it('should return error for non-existent shell_id', () => {
      const result = manager.kill('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should remove process from registry after killing', async () => {
      const process = createMockProcess();
      manager.register('test-1', createShellProcess(process));

      manager.kill('test-1');

      const result = await manager.getOutput({ shell_id: 'test-1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle kill error gracefully', () => {
      const process = createMockProcess();
      (process.kill as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Kill failed');
      });
      manager.register('test-1', createShellProcess(process));

      const result = manager.kill('test-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Kill failed');
    });
  });

  describe('cleanupAll', () => {
    it('should kill all registered processes', async () => {
      const p1 = createMockProcess();
      const p2 = createMockProcess();
      manager.register('test-1', createShellProcess(p1));
      manager.register('test-2', createShellProcess(p2));

      manager.cleanupAll();

      expect(p1.kill).toHaveBeenCalled();
      expect(p2.kill).toHaveBeenCalled();
      expect((await manager.getOutput({ shell_id: 'test-1' })).success).toBe(false);
      expect((await manager.getOutput({ shell_id: 'test-2' })).success).toBe(false);
    });

    it('should handle kill errors during cleanup', () => {
      const p1 = createMockProcess();
      (p1.kill as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('fail');
      });
      manager.register('test-1', createShellProcess(p1));

      expect(() => manager.cleanupAll()).not.toThrow();
    });
  });
});
