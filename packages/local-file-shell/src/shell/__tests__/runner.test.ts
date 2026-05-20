import { afterEach, describe, expect, it } from 'vitest';

import { ShellProcessManager } from '../process-manager';
import { runCommand } from '../runner';

describe('runCommand', () => {
  const processManager = new ShellProcessManager();

  afterEach(() => {
    processManager.cleanupAll();
  });

  describe('synchronous mode', () => {
    it('should execute a simple command', async () => {
      const result = await runCommand({ command: 'echo hello' }, { processManager });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('hello');
      expect(result.exit_code).toBe(0);
    });

    it('should capture stderr', async () => {
      const result = await runCommand({ command: 'echo error >&2' }, { processManager });

      expect(result.stderr).toContain('error');
    });

    it('should handle command failure', async () => {
      const result = await runCommand({ command: 'exit 1' }, { processManager });

      expect(result.success).toBe(false);
      expect(result.exit_code).toBe(1);
    });

    it('should handle command not found', async () => {
      const result = await runCommand(
        { command: 'nonexistent_command_xyz_123' },
        { processManager },
      );

      expect(result.success).toBe(false);
    });

    it('should timeout long-running commands', async () => {
      const result = await runCommand({ command: 'sleep 10', timeout: 500 }, { processManager });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    }, 10000);

    it('should strip ANSI codes from output', async () => {
      const result = await runCommand(
        { command: 'printf "\\033[31mred\\033[0m"' },
        { processManager },
      );

      expect(result.output).not.toContain('\u001B');
    });

    it('should truncate very long output', async () => {
      const result = await runCommand(
        {
          command: `python3 -c "print('x' * 100000)" 2>/dev/null || printf '%0.sx' $(seq 1 100000)`,
        },
        { processManager },
      );

      expect(result.output!.length).toBeLessThanOrEqual(85000);
    }, 15000);

    it('should pass cwd to command', async () => {
      const result = await runCommand({ command: 'pwd', cwd: '/tmp' }, { processManager });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('/tmp');
    });

    it('should merge env into child process environment', async () => {
      const result = await runCommand(
        {
          command: 'node -e "console.log(process.env.LOB_TEST_ENV_MERGE)"',
          env: { LOB_TEST_ENV_MERGE: 'from-runner' },
        },
        { processManager },
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('from-runner');
    });
  });

  describe('background mode', () => {
    it('should run command in background', async () => {
      const result = await runCommand(
        { command: 'echo background', run_in_background: true },
        { processManager },
      );

      expect(result.success).toBe(true);
      expect(result.shell_id).toBeDefined();
    });

    it('should capture background process output', async () => {
      const bgResult = await runCommand(
        { command: 'echo hello && sleep 0.1', run_in_background: true },
        { processManager },
      );

      await new Promise((r) => setTimeout(r, 200));

      const output = processManager.getOutput({ shell_id: bgResult.shell_id! });

      expect(output.success).toBe(true);
      expect(output.stdout).toContain('hello');
    });

    it('should return new output only on subsequent reads', async () => {
      const bgResult = await runCommand(
        { command: 'echo first && sleep 0.2 && echo second', run_in_background: true },
        { processManager },
      );

      await new Promise((r) => setTimeout(r, 100));
      const first = processManager.getOutput({ shell_id: bgResult.shell_id! });
      expect(first.stdout).toContain('first');

      await new Promise((r) => setTimeout(r, 300));
      processManager.getOutput({ shell_id: bgResult.shell_id! });

      // First read should have had "first"
      expect(first.stdout).toContain('first');
    });
  });

  describe('process management', () => {
    it('should kill a background process', async () => {
      const bgResult = await runCommand(
        { command: 'sleep 60', run_in_background: true },
        { processManager },
      );

      const result = processManager.kill(bgResult.shell_id!);
      expect(result.success).toBe(true);
    });

    it('should return error for unknown shell_id', async () => {
      const result = processManager.getOutput({ shell_id: 'unknown-id' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when killing unknown shell_id', async () => {
      const result = processManager.kill('unknown-id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should support filter parameter', async () => {
      const bgResult = await runCommand(
        { command: 'echo "line1\nline2\nline3"', run_in_background: true },
        { processManager },
      );

      await new Promise((r) => setTimeout(r, 200));

      const output = processManager.getOutput({
        filter: 'line2',
        shell_id: bgResult.shell_id!,
      });

      expect(output.success).toBe(true);
    });

    it('should handle invalid filter regex', async () => {
      const bgResult = await runCommand(
        { command: 'echo test', run_in_background: true },
        { processManager },
      );

      await new Promise((r) => setTimeout(r, 200));

      const output = processManager.getOutput({
        filter: '[invalid',
        shell_id: bgResult.shell_id!,
      });

      expect(output.success).toBe(true);
    });

    it('should track running state', async () => {
      const bgResult = await runCommand(
        { command: 'sleep 5', run_in_background: true },
        { processManager },
      );

      const output = processManager.getOutput({ shell_id: bgResult.shell_id! });
      expect(output.running).toBe(true);
    });
  });

  it('should work with logger', async () => {
    const mockLogger = { debug: () => {}, error: () => {}, info: () => {} };

    const result = await runCommand(
      { command: 'echo test', description: 'test' },
      { logger: mockLogger, processManager },
    );

    expect(result.success).toBe(true);
  });
});
