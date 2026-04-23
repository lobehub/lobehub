import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { ProcessRegistry } from '@lobechat/process-registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellProcessManager } from '../process-manager';

function createMockProcess(exitCode: number | null = null): ChildProcess {
  return {
    exitCode,
    kill: vi.fn(),
  } as unknown as ChildProcess;
}

function createRegistryProcess(pid = 4321): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess;
  (emitter as any).pid = pid;
  (emitter as any).exitCode = null;
  (emitter as any).kill = vi.fn();
  return emitter;
}

describe('ShellProcessManager', () => {
  let manager: ShellProcessManager;

  beforeEach(() => {
    manager = new ShellProcessManager();
  });

  describe('getOutput', () => {
    it('should return error for non-existent shell_id', () => {
      const result = manager.getOutput({ shell_id: 'non-existent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.running).toBe(false);
    });

    it('should retrieve stdout and stderr', () => {
      const process = createMockProcess();
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process,
        stderr: ['error line\n'],
        stdout: ['line 1\n', 'line 2\n'],
      });

      const result = manager.getOutput({ shell_id: 'test-1' });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('line 1');
      expect(result.stdout).toContain('line 2');
      expect(result.stderr).toContain('error line');
    });

    it('should only return new output since last read', () => {
      const process = createMockProcess();
      const shellProcess = {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process,
        stderr: [] as string[],
        stdout: ['first\n'],
      };
      manager.register('test-1', shellProcess);

      const first = manager.getOutput({ shell_id: 'test-1' });
      expect(first.stdout).toContain('first');

      // No new output
      const second = manager.getOutput({ shell_id: 'test-1' });
      expect(second.stdout).toBe('');
      expect(second.stderr).toBe('');

      // Add new output
      shellProcess.stdout.push('second\n');
      const third = manager.getOutput({ shell_id: 'test-1' });
      expect(third.stdout).toContain('second');
      expect(third.stdout).not.toContain('first');
    });

    it('should track stdout and stderr offsets separately', () => {
      const process = createMockProcess();
      const shellProcess = {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process,
        stderr: [] as string[],
        stdout: [] as string[],
      };
      manager.register('test-1', shellProcess);

      // Add stderr only
      shellProcess.stderr.push('error 1\n');
      const read1 = manager.getOutput({ shell_id: 'test-1' });
      expect(read1.stderr).toBe('error 1\n');
      expect(read1.stdout).toBe('');

      // Add stdout only
      shellProcess.stdout.push('output 1\n');
      const read2 = manager.getOutput({ shell_id: 'test-1' });
      expect(read2.stdout).toBe('output 1\n');
      expect(read2.stderr).toBe('');
    });

    it('should filter output with regex', () => {
      const process = createMockProcess();
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process,
        stderr: [],
        stdout: ['line 1\n', 'line 2\n', 'line 3\n'],
      });

      const result = manager.getOutput({ filter: 'line 1', shell_id: 'test-1' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('line 1');
      expect(result.output).not.toContain('line 2');
    });

    it('should handle invalid regex filter gracefully', () => {
      const process = createMockProcess();
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process,
        stderr: [],
        stdout: ['output\n'],
      });

      const result = manager.getOutput({ filter: '[invalid(regex', shell_id: 'test-1' });

      expect(result.success).toBe(true);
      // Should return unfiltered output
    });

    it('should report running status correctly', () => {
      const runningProcess = createMockProcess(null);
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process: runningProcess,
        stderr: [],
        stdout: [],
      });

      expect(manager.getOutput({ shell_id: 'test-1' }).running).toBe(true);

      // Simulate exit
      (runningProcess as any).exitCode = 0;
      expect(manager.getOutput({ shell_id: 'test-1' }).running).toBe(false);
    });
  });

  describe('kill', () => {
    it('should kill process successfully', () => {
      const process = createMockProcess();
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process,
        stderr: [],
        stdout: [],
      });

      const result = manager.kill('test-1');

      expect(result.success).toBe(true);
      expect(process.kill).toHaveBeenCalled();
    });

    it('should return error for non-existent shell_id', () => {
      const result = manager.kill('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should remove process from registry after killing', () => {
      const process = createMockProcess();
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process,
        stderr: [],
        stdout: [],
      });

      manager.kill('test-1');

      const result = manager.getOutput({ shell_id: 'test-1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle kill error gracefully', () => {
      const process = createMockProcess();
      (process.kill as any).mockImplementation(() => {
        throw new Error('Kill failed');
      });
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process,
        stderr: [],
        stdout: [],
      });

      const result = manager.kill('test-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Kill failed');
    });
  });

  describe('cleanupAll', () => {
    it('should kill all registered processes', () => {
      const p1 = createMockProcess();
      const p2 = createMockProcess();
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process: p1,
        stderr: [],
        stdout: [],
      });
      manager.register('test-2', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process: p2,
        stderr: [],
        stdout: [],
      });

      manager.cleanupAll();

      expect(p1.kill).toHaveBeenCalled();
      expect(p2.kill).toHaveBeenCalled();
      expect(manager.getOutput({ shell_id: 'test-1' }).success).toBe(false);
      expect(manager.getOutput({ shell_id: 'test-2' }).success).toBe(false);
    });

    it('should handle kill errors during cleanup', () => {
      const p1 = createMockProcess();
      (p1.kill as any).mockImplementation(() => {
        throw new Error('fail');
      });
      manager.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process: p1,
        stderr: [],
        stdout: [],
      });

      // Should not throw
      expect(() => manager.cleanupAll()).not.toThrow();
    });
  });

  describe('with ProcessRegistry', () => {
    it('delegates register to the registry when command + tags are provided', () => {
      const registry = new ProcessRegistry();
      const m = new ShellProcessManager({ registry });
      const child = createRegistryProcess(111);

      m.register(
        'test-1',
        { lastReadStderr: 0, lastReadStdout: 0, process: child, stderr: [], stdout: [] },
        { command: 'ls', tags: { ownerModule: 'shell', topicId: 't1' } },
      );

      expect(registry.get('test-1')?.tags.topicId).toBe('t1');
      expect(registry.get('test-1')?.pid).toBe(111);
    });

    it('skips registry when meta is missing (back-compat)', () => {
      const registry = new ProcessRegistry();
      const m = new ShellProcessManager({ registry });
      const child = createMockProcess();
      m.register('test-1', {
        lastReadStderr: 0,
        lastReadStdout: 0,
        process: child,
        stderr: [],
        stdout: [],
      });
      expect(registry.get('test-1')).toBeUndefined();
    });

    it('kill() delegates to registry.kill (tree-kill path)', () => {
      const registry = new ProcessRegistry();
      const m = new ShellProcessManager({ registry });
      const child = createRegistryProcess(222);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      m.register(
        'test-1',
        { lastReadStderr: 0, lastReadStdout: 0, process: child, stderr: [], stdout: [] },
        { command: 'sleep', tags: { ownerModule: 'shell' } },
      );
      const result = m.kill('test-1');

      expect(result.success).toBe(true);
      expect(registry.get('test-1')?.status).toBe('killed');
      // Raw child.kill is NOT used; registry path uses process.kill(-pgid) on unix
      expect((child as any).kill).not.toHaveBeenCalled();
      killSpy.mockRestore();
    });
  });
});
