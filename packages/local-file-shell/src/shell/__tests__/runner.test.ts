import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { srtSandboxRuntime } from '@lobechat/device-sandbox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ShellProcessManager } from '../process-manager';
import { runCommand } from '../runner';

describe('runCommand', () => {
  let processManager: ShellProcessManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobehub-shell-runner-'));
    processManager = new ShellProcessManager(tmpDir);
  });

  afterEach(async () => {
    processManager.cleanupAll();
    await srtSandboxRuntime.shutdown();
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  describe('foreground observation mode', () => {
    it('should execute a simple command and finish immediately', async () => {
      const result = await runCommand({ command: 'echo hello' }, { processManager });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('hello');
      expect(result.exit_code).toBe(0);
      expect(result.shell_id).toBeDefined();
    });

    it('should assign readable incremental shell IDs within a manager', async () => {
      const localManager = new ShellProcessManager(tmpDir);

      const first = await runCommand({ command: 'echo first' }, { processManager: localManager });
      const second = await runCommand({ command: 'echo second' }, { processManager: localManager });

      expect(first.shell_id).toBe('sh-1');
      expect(second.shell_id).toBe('sh-2');
      localManager.cleanupAll();
    });

    it('should capture stderr output separately', async () => {
      const result = await runCommand({ command: 'echo error >&2' }, { processManager });

      expect(result.stderr).toContain('error');
    });

    it('should handle command failure', async () => {
      const result = await runCommand({ command: 'exit 1' }, { processManager });

      expect(result.success).toBe(true);
      expect(result.exit_code).toBe(1);
    });

    it('should handle command not found', async () => {
      const result = await runCommand(
        { command: 'nonexistent_command_xyz_123' },
        { processManager },
      );

      expect(result.success).toBe(true);
      expect(result.exit_code).not.toBe(0);
    });

    it('should return partial observation instead of killing long-running commands', async () => {
      const result = await runCommand(
        { command: 'sleep 1 && echo done', timeout: 100 },
        { processManager },
      );

      expect(result.success).toBe(true);
      expect(result.exit_code).toBeUndefined();
      expect(result.shell_id).toBeDefined();
    }, 10_000);

    it('should strip ANSI codes from output', async () => {
      const result = await runCommand(
        { command: 'printf "\\033[31mred\\033[0m"' },
        { processManager },
      );

      expect(result.stdout).not.toContain('\u001B');
    });

    it('should truncate very long output', async () => {
      const result = await runCommand(
        {
          command: `python3 -c "print('x' * 100000)" 2>/dev/null || printf '%0.sx' $(seq 1 100000)`,
        },
        { processManager },
      );

      expect(result.stdout!.length).toBeLessThanOrEqual(85_000);
    }, 15_000);

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

    it('should keep the existing unsandboxed behavior when no sandbox policy is provided', async () => {
      const target = path.join(tmpDir, 'default-path.txt');
      const result = await runCommand(
        {
          command: `printf "%s" "$LOB_TEST_DEFAULT_PATH" > ${JSON.stringify(target)}`,
          env: { LOB_TEST_DEFAULT_PATH: 'sandbox-disabled' },
        },
        { processManager },
      );

      expect(result).toMatchObject({ exit_code: 0, success: true });
      expect(fs.readFileSync(target, 'utf8')).toBe('sandbox-disabled');
    });

    it.skipIf(process.platform !== 'darwin')(
      'should execute through the device sandbox and reject writes outside its policy',
      async () => {
        const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-shell-sandbox-allowed-'));
        const deniedTarget = path.join(tmpDir, 'denied.txt');

        try {
          const result = await runCommand(
            { command: `printf denied > ${JSON.stringify(deniedTarget)}` },
            {
              processManager,
              sandboxPolicy: {
                allowNetwork: false,
                onUnavailable: 'deny',
                writableRoots: [allowedRoot],
              },
            },
          );

          expect(result.success).toBe(true);
          expect(result.exit_code).not.toBe(0);
          expect(fs.existsSync(deniedTarget)).toBe(false);
        } finally {
          fs.rmSync(allowedRoot, { force: true, recursive: true });
        }
      },
    );

    it.skipIf(process.platform !== 'darwin')(
      'should preserve output and hide non-allowlisted environment variables in the sandbox',
      async () => {
        const result = await runCommand(
          {
            command: 'printf "output:%s" "${LOB_TEST_SANDBOX_SECRET-unset}"',
            env: { LOB_TEST_SANDBOX_SECRET: 'must-not-leak' },
          },
          {
            processManager,
            sandboxPolicy: {
              allowNetwork: false,
              onUnavailable: 'deny',
              writableRoots: [tmpDir],
            },
          },
        );

        expect(result).toMatchObject({ exit_code: 0, success: true });
        expect(result.stdout).toContain('output:unset');
      },
    );

    it('should fail before spawn when a required sandbox backend is unavailable', async () => {
      const result = await runCommand(
        { command: 'echo should-not-run' },
        {
          processManager,
          sandboxPolicy: {
            allowNetwork: false,
            onUnavailable: 'deny',
            writableRoots: ['relative-root'],
          },
        },
      );

      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain('must be absolute');
    });
  });

  describe('background mode', () => {
    it('should run command in background and return a shell_id', async () => {
      const result = await runCommand(
        { command: 'echo background', run_in_background: true },
        { processManager },
      );

      expect(result.success).toBe(true);
      expect(result.shell_id).toBeDefined();
      expect(result.exit_code).toBeUndefined();
      expect(result.output_files?.stdout.path).toMatch(/sh-\d+\/stdout\.log$/);
      expect(result.stdout).toBeUndefined();
    });

    it('should capture background process output', async () => {
      const bgResult = await runCommand(
        { command: 'echo hello && sleep 0.1', run_in_background: true },
        { processManager },
      );

      await new Promise((r) => setTimeout(r, 200));

      const output = await processManager.getOutput({ shell_id: bgResult.shell_id! });

      expect(output.success).toBe(true);
      expect(output.stdout).toContain('hello');
    });

    it('should return the latest tail snapshot on subsequent reads', async () => {
      const bgResult = await runCommand(
        { command: 'echo first && sleep 0.2 && echo second', run_in_background: true },
        { processManager },
      );

      await new Promise((r) => setTimeout(r, 100));
      const first = await processManager.getOutput({ shell_id: bgResult.shell_id!, timeout: 0 });
      expect(first.stdout).toContain('first');

      await new Promise((r) => setTimeout(r, 300));
      const second = await processManager.getOutput({ shell_id: bgResult.shell_id!, timeout: 0 });
      expect(second.stdout).toContain('second');
    });

    it.skipIf(process.platform !== 'darwin')(
      'should preserve background execution through the device sandbox',
      async () => {
        const result = await runCommand(
          { command: 'sleep 0.05 && echo sandbox-background', run_in_background: true },
          {
            processManager,
            sandboxPolicy: {
              allowNetwork: false,
              onUnavailable: 'deny',
              writableRoots: [tmpDir],
            },
          },
        );

        const output = await processManager.getOutput({ shell_id: result.shell_id! });
        expect(output).toMatchObject({ exit_code: 0, success: true });
        expect(output.stdout).toContain('sandbox-background');
      },
    );

    it.skipIf(process.platform !== 'darwin')(
      'should release the sandbox runtime after a background command is killed',
      async () => {
        const result = await runCommand(
          { command: 'sleep 60', run_in_background: true },
          {
            processManager,
            sandboxPolicy: {
              allowNetwork: false,
              onUnavailable: 'deny',
              writableRoots: [tmpDir],
            },
          },
        );

        expect(processManager.kill(result.shell_id!).success).toBe(true);

        const startedAt = Date.now();
        while (Date.now() - startedAt < 2000) {
          const output = await processManager.getOutput({ shell_id: result.shell_id!, timeout: 0 });
          if (output.exit_code !== undefined) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        await expect(srtSandboxRuntime.shutdown()).resolves.toBeUndefined();
      },
      10_000,
    );
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

    it.skipIf(process.platform === 'win32')(
      'should kill nested background process tree',
      async () => {
        // Reproduce the orphaned-child case: the shell command keeps a nested
        // writer alive that appends to a marker file. After kill(), the marker
        // size must stop changing, proving the whole process tree was killed.
        const markerPath = path.join(tmpDir, 'nested-process-marker.log');
        const bgResult = await runCommand(
          {
            command: `sh -c 'while :; do printf "tick\\n" >> "$LOB_TEST_MARKER"; sleep 0.05; done'`,
            env: { LOB_TEST_MARKER: markerPath },
            run_in_background: true,
          },
          { processManager },
        );

        const startedAt = Date.now();
        while (
          Date.now() - startedAt < 2000 &&
          (!fs.existsSync(markerPath) || fs.statSync(markerPath).size === 0)
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(fs.existsSync(markerPath) && fs.statSync(markerPath).size > 0).toBe(true);

        const result = processManager.kill(bgResult.shell_id!);
        expect(result.success).toBe(true);

        await new Promise((r) => setTimeout(r, 100));
        const sizeAfterKill = fs.statSync(markerPath).size;

        await new Promise((r) => setTimeout(r, 300));
        expect(fs.statSync(markerPath).size).toBe(sizeAfterKill);
      },
      10_000,
    );

    it('should return error for unknown shell_id', async () => {
      const result = await processManager.getOutput({ shell_id: 'unknown-id' });
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

      const output = await processManager.getOutput({
        filter: 'line2',
        shell_id: bgResult.shell_id!,
      });

      expect(output.success).toBe(true);
      expect(output.stdout).toContain('line2');
    });

    it('should handle invalid filter regex', async () => {
      const bgResult = await runCommand(
        { command: 'echo test', run_in_background: true },
        { processManager },
      );

      await new Promise((r) => setTimeout(r, 200));

      const output = await processManager.getOutput({
        filter: '[invalid',
        shell_id: bgResult.shell_id!,
      });

      expect(output.success).toBe(true);
    });

    it('should track running state after completion', async () => {
      const bgResult = await runCommand(
        { command: 'sleep 0.05', run_in_background: true },
        { processManager },
      );

      await new Promise((r) => setTimeout(r, 100));
      const output = await processManager.getOutput({ shell_id: bgResult.shell_id! });
      expect(output.exit_code).toBe(0);
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
