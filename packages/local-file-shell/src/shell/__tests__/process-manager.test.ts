import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShellProcess } from '../process-manager';
import { ShellProcessManager } from '../process-manager';

function createMockProcess(exitCode: number | null = null, pid?: number): ChildProcess {
  const process = new EventEmitter() as ChildProcess;
  // Node types expose `exitCode` as readonly; make the test double writable so
  // we can simulate the child process exiting.
  Object.defineProperty(process, 'exitCode', {
    configurable: true,
    value: exitCode,
    writable: true,
  });
  Object.defineProperty(process, 'pid', {
    configurable: true,
    value: pid,
  });
  process.kill = vi.fn() as unknown as ChildProcess['kill'];
  return process;
}

function createShellProcess(
  manager: ShellProcessManager,
  shellId: string,
  process: ChildProcess,
): ShellProcess {
  return {
    exitCode: process.exitCode,
    outputFiles: manager.createOutputFiles(shellId),
    process,
  };
}

function writeOutput(shellProcess: ShellProcess, content: string): void {
  // Simulate child stdout writing into the inherited output fd.
  const buffer = Buffer.from(content);
  fs.writeSync(shellProcess.outputFiles.stdout.fd, buffer);
}

describe('ShellProcessManager', () => {
  let manager: ShellProcessManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobehub-shell-process-manager-'));
    manager = new ShellProcessManager(tmpDir);
  });

  afterEach(() => {
    manager.cleanupAll();
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  describe('getOutput', () => {
    it('should return error for non-existent shell_id', async () => {
      const result = await manager.getOutput({ shell_id: 'non-existent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should retrieve merged output', async () => {
      const process = createMockProcess();
      const shellProcess = createShellProcess(manager, 'test-1', process);
      writeOutput(shellProcess, 'line 1\nline 2\n');
      writeOutput(shellProcess, 'error line\n');
      manager.register('test-1', shellProcess);

      const result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('line 1');
      expect(result.stdout).toContain('line 2');
      expect(result.stdout).toContain('error line');
      expect(result.exit_code).toBeUndefined();
    });

    it('should return a tail snapshot on repeated reads', async () => {
      const process = createMockProcess();
      const shellProcess = createShellProcess(manager, 'test-1', process);
      writeOutput(shellProcess, 'first\n');
      manager.register('test-1', shellProcess);

      const first = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(first.stdout).toContain('first');

      const second = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(second.stdout).toContain('first');

      writeOutput(shellProcess, 'second\n');
      const third = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(third.stdout).toContain('second');
    });

    it('should return the current output snapshot when observation timeout elapses', async () => {
      vi.useFakeTimers();
      try {
        const process = createMockProcess();
        const shellProcess = createShellProcess(manager, 'test-1', process);
        manager.register('test-1', shellProcess);
        let resolved = false;

        const pending = manager.getOutput({ shell_id: 'test-1', timeout: 100 }).then((result) => {
          resolved = true;
          return result;
        });

        setTimeout(() => {
          writeOutput(shellProcess, 'delayed\n');
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
        const shellProcess = createShellProcess(manager, 'test-1', process);
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
      manager.register('test-1', createShellProcess(manager, 'test-1', process));

      const pending = manager.getOutput({ shell_id: 'test-1', timeout: 100 });

      setTimeout(() => {
        (process as { exitCode: number | null }).exitCode = 0;
        process.emit('exit', 0);
        process.emit('close', 0);
      }, 20);

      const result = await pending;
      expect(result.exit_code).toBe(0);
    });

    it('should wait for close before reading final output', async () => {
      const process = createMockProcess();
      const shellProcess = createShellProcess(manager, 'test-1', process);
      manager.register('test-1', shellProcess);

      // A child process can emit "exit" before stdio has fully closed. The
      // manager should wait for "close" before reading the final snapshot so
      // late-flushed output is not missed.
      const pending = manager.getOutput({ shell_id: 'test-1', timeout: 100 });

      setTimeout(() => {
        (process as { exitCode: number | null }).exitCode = 0;
        process.emit('exit', 0);
        writeOutput(shellProcess, 'late output after exit\n');
        process.emit('close', 0);
      }, 20);

      const result = await pending;
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toContain('late output after exit');
    });

    it('should wait for close after the parent output fd has been released', async () => {
      const process = createMockProcess();
      const shellProcess = createShellProcess(manager, 'test-1', process);
      manager.register('test-1', shellProcess);
      manager.closeOutputFiles(shellProcess.outputFiles);

      const pending = manager.getOutput({ shell_id: 'test-1', timeout: 100 });

      setTimeout(() => {
        (process as { exitCode: number | null }).exitCode = 0;
        process.emit('exit', 0);
        fs.appendFileSync(shellProcess.outputFiles.stdout.path, 'late child output after exit\n');
        process.emit('close', 0);
      }, 20);

      const result = await pending;
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toContain('late child output after exit');
    });

    it('should filter output with regex', async () => {
      const process = createMockProcess();
      const shellProcess = createShellProcess(manager, 'test-1', process);
      writeOutput(shellProcess, 'line 1\nline 2\nline 3\n');
      manager.register('test-1', shellProcess);

      const result = await manager.getOutput({ filter: 'line 1', shell_id: 'test-1', timeout: 0 });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('line 1');
      expect(result.stdout).not.toContain('line 2');
    });

    it('should filter consecutive matching lines', async () => {
      const process = createMockProcess();
      const shellProcess = createShellProcess(manager, 'test-1', process);
      writeOutput(shellProcess, 'match one\nmatch two\nskip\n');
      manager.register('test-1', shellProcess);

      const result = await manager.getOutput({ filter: '^match', shell_id: 'test-1', timeout: 0 });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('match one');
      expect(result.stdout).toContain('match two');
      expect(result.stdout).not.toContain('skip');
    });

    it('should handle invalid regex filter gracefully', async () => {
      const process = createMockProcess();
      const shellProcess = createShellProcess(manager, 'test-1', process);
      writeOutput(shellProcess, 'output\n');
      manager.register('test-1', shellProcess);

      const result = await manager.getOutput({
        filter: '[invalid(regex',
        shell_id: 'test-1',
        timeout: 0,
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('output');
    });

    it('should reflect completion via exit_code', async () => {
      const process = createMockProcess();
      manager.register('test-1', createShellProcess(manager, 'test-1', process));

      let result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(result.exit_code).toBeUndefined();

      (process as { exitCode: number | null }).exitCode = 0;
      process.emit('close', 0);

      result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(result.exit_code).toBe(0);
    });

    it('should report elapsed duration while the process is still running', async () => {
      vi.useFakeTimers();
      try {
        const process = createMockProcess();
        manager.register('test-1', createShellProcess(manager, 'test-1', process));

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
        manager.register('test-1', createShellProcess(manager, 'test-1', process));

        await vi.advanceTimersByTimeAsync(2500);
        (process as { exitCode: number | null }).exitCode = 0;
        process.emit('exit', 0);
        process.emit('close', 0);
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
      const shellProcess = createShellProcess(manager, 'test-1', process);
      writeOutput(shellProcess, 'done\n');
      manager.register('test-1', shellProcess);

      (process as { exitCode: number | null }).exitCode = 0;
      process.emit('close', 0);

      const result = await manager.getOutput({ shell_id: 'test-1', timeout: 0 });
      expect(result.success).toBe(true);
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toContain('done');
    });
  });

  describe('kill', () => {
    it('should kill process successfully', () => {
      const process = createMockProcess();
      manager.register('test-1', createShellProcess(manager, 'test-1', process));

      const result = manager.kill('test-1');

      expect(result.success).toBe(true);
      expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it.skipIf(process.platform === 'win32')('should kill the process tree by pid', async () => {
      const killSpy = vi.spyOn(globalThis.process, 'kill').mockImplementation(() => true);
      try {
        const process = createMockProcess(null, 12_345);
        manager.register('test-1', createShellProcess(manager, 'test-1', process));

        const result = manager.kill('test-1');

        expect(result.success).toBe(true);
        await waitUntil(() => killSpy.mock.calls.some(([pid]) => pid === 12_345));
        expect(killSpy).toHaveBeenCalledWith(12_345, 'SIGKILL');
        expect(process.kill).not.toHaveBeenCalled();
      } finally {
        killSpy.mockRestore();
      }
    });

    it('should return error for non-existent shell_id', () => {
      const result = manager.kill('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should remove process from registry after killing', async () => {
      const process = createMockProcess();
      manager.register('test-1', createShellProcess(manager, 'test-1', process));

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
      manager.register('test-1', createShellProcess(manager, 'test-1', process));

      const result = manager.kill('test-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Kill failed');
    });
  });

  describe('cleanupAll', () => {
    it('should kill all registered processes', async () => {
      const p1 = createMockProcess();
      const p2 = createMockProcess();
      manager.register('test-1', createShellProcess(manager, 'test-1', p1));
      manager.register('test-2', createShellProcess(manager, 'test-2', p2));

      manager.cleanupAll();

      expect(p1.kill).toHaveBeenCalledWith('SIGKILL');
      expect(p2.kill).toHaveBeenCalledWith('SIGKILL');
      expect((await manager.getOutput({ shell_id: 'test-1' })).success).toBe(false);
      expect((await manager.getOutput({ shell_id: 'test-2' })).success).toBe(false);
    });

    it('should handle kill errors during cleanup', () => {
      const p1 = createMockProcess();
      (p1.kill as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('fail');
      });
      manager.register('test-1', createShellProcess(manager, 'test-1', p1));

      expect(() => manager.cleanupAll()).not.toThrow();
    });
  });
});

describe('ShellProcessManager default output root', () => {
  it('should keep the default shell output path short and under the system temp dir', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 5, 14, 12, 34, 56));
      const manager = new ShellProcessManager();
      const outputFiles = manager.createOutputFiles('sh-1');

      expect(outputFiles.stdout.path).toBe(
        path.join(
          os.tmpdir(),
          'lobehub',
          'shell',
          '2026-6-14',
          process.pid.toString(),
          'sh-1',
          'stdout.log',
        ),
      );
      expect(fs.existsSync(outputFiles.stdout.path)).toBe(true);
      manager.cleanupAll();
    } finally {
      vi.useRealTimers();
      fs.rmSync(path.join(os.tmpdir(), 'lobehub', 'shell', '2026-6-14', process.pid.toString()), {
        force: true,
        recursive: true,
      });
    }
  });
});

const waitUntil = async (predicate: () => boolean, timeout = 2000): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for condition');
};
