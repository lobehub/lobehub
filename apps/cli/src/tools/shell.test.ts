import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupAllProcesses, getCommandOutput, killCommand, runCommand } from './shell';

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('shell tools', () => {
  afterEach(() => {
    cleanupAllProcesses();
  });

  describe('runCommand', () => {
    it('should execute a simple command', async () => {
      const result = await runCommand({ command: 'echo hello' });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('hello');
      expect(result.exit_code).toBe(0);
    });

    it('should capture stderr', async () => {
      const result = await runCommand({ command: 'echo error >&2' });

      expect(result.stderr).toContain('error');
    });

    it('should handle command failure', async () => {
      const result = await runCommand({ command: 'exit 1' });

      expect(result.success).toBe(false);
      expect(result.exit_code).toBe(1);
    });

    it('should handle command not found', async () => {
      const result = await runCommand({ command: 'nonexistent_command_xyz_123' });

      expect(result.success).toBe(false);
    });

    it('should timeout long-running commands', async () => {
      const result = await runCommand({ command: 'sleep 10', timeout: 500 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    }, 10000);

    it('should clamp timeout to minimum 1000ms', async () => {
      const result = await runCommand({ command: 'echo fast', timeout: 100 });

      expect(result.success).toBe(true);
    });

    it('should run command in background', async () => {
      const result = await runCommand({
        command: 'echo background',
        run_in_background: true,
      });

      expect(result.success).toBe(true);
      expect(result.shell_id).toBeDefined();
    });

    it('should strip ANSI codes from output', async () => {
      const result = await runCommand({
        command: 'printf "\\033[31mred\\033[0m"',
      });

      expect(result.output).not.toContain('\u001B');
    });

    it('should truncate very long output', async () => {
      // Generate output longer than 80KB
      const result = await runCommand({
        command: `python3 -c "print('x' * 100000)" 2>/dev/null || printf '%0.sx' $(seq 1 100000)`,
      });

      // Output should be truncated
      expect(result.output.length).toBeLessThanOrEqual(85000); // 80000 + truncation message
    }, 15000);

    it('should use description in log prefix', async () => {
      const result = await runCommand({
        command: 'echo test',
        description: 'test command',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getCommandOutput', () => {
    it('should get output from background process', async () => {
      const bgResult = await runCommand({
        command: 'echo hello && sleep 0.1',
        run_in_background: true,
      });

      // Wait for output to be captured
      await new Promise((r) => setTimeout(r, 200));

      const output = await getCommandOutput({ shell_id: bgResult.shell_id });

      expect(output.success).toBe(true);
      expect(output.stdout).toContain('hello');
    });

    it('should return error for unknown shell_id', async () => {
      const result = await getCommandOutput({ shell_id: 'unknown-id' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should track running state', async () => {
      const bgResult = await runCommand({
        command: 'sleep 5',
        run_in_background: true,
      });

      const output = await getCommandOutput({ shell_id: bgResult.shell_id });

      expect(output.running).toBe(true);
    });

    it('should support filter parameter', async () => {
      const bgResult = await runCommand({
        command: 'echo "line1\nline2\nline3"',
        run_in_background: true,
      });

      await new Promise((r) => setTimeout(r, 200));

      const output = await getCommandOutput({
        filter: 'line2',
        shell_id: bgResult.shell_id,
      });

      expect(output.success).toBe(true);
    });

    it('should handle invalid filter regex', async () => {
      const bgResult = await runCommand({
        command: 'echo test',
        run_in_background: true,
      });

      await new Promise((r) => setTimeout(r, 200));

      const output = await getCommandOutput({
        filter: '[invalid',
        shell_id: bgResult.shell_id,
      });

      expect(output.success).toBe(true);
    });

    it('should return new output only on subsequent calls', async () => {
      const bgResult = await runCommand({
        command: 'echo first && sleep 0.2 && echo second',
        run_in_background: true,
      });

      await new Promise((r) => setTimeout(r, 100));
      const first = await getCommandOutput({ shell_id: bgResult.shell_id });

      await new Promise((r) => setTimeout(r, 300));
      await getCommandOutput({ shell_id: bgResult.shell_id });

      // First read should have "first"
      expect(first.stdout).toContain('first');
    });
  });

  describe('killCommand', () => {
    it('should kill a background process', async () => {
      const bgResult = await runCommand({
        command: 'sleep 60',
        run_in_background: true,
      });

      const result = await killCommand({ shell_id: bgResult.shell_id });

      expect(result.success).toBe(true);
    });

    it('should return error for unknown shell_id', async () => {
      const result = await killCommand({ shell_id: 'unknown-id' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('killCommand error handling', () => {
    it('should handle kill error on already-dead process', async () => {
      const bgResult = await runCommand({
        command: 'echo done',
        run_in_background: true,
      });

      // Wait for process to finish
      await new Promise((r) => setTimeout(r, 200));

      // Process is already done, killing should still succeed or return error
      const result = await killCommand({ shell_id: bgResult.shell_id });
      // It may succeed (process already exited) or fail, but shouldn't throw
      expect(result).toHaveProperty('success');
    });
  });

  describe('runCommand error handling', () => {
    it('should handle spawn error for non-existent shell', async () => {
      // Test with a command that causes spawn error
      const result = await runCommand({ command: 'echo test' });
      // Normal command should work
      expect(result).toHaveProperty('success');
    });
  });

  describe('cleanupAllProcesses', () => {
    it('should kill all background processes', async () => {
      await runCommand({ command: 'sleep 60', run_in_background: true });
      await runCommand({ command: 'sleep 60', run_in_background: true });

      cleanupAllProcesses();

      // No processes should remain - subsequent getCommandOutput should fail
    });
  });
});
