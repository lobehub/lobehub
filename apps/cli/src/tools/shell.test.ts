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

describe('shell tools (integration wrapper)', () => {
  afterEach(() => {
    cleanupAllProcesses();
  });

  it('should delegate runCommand to shared package', async () => {
    const result = await runCommand({ command: 'echo hello' });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello');
  });

  it('should delegate background commands and getCommandOutput', async () => {
    const bgResult = await runCommand({
      command: 'echo background && sleep 0.1',
      run_in_background: true,
    });

    expect(bgResult.success).toBe(true);
    expect(bgResult.shell_id).toBeDefined();

    await new Promise((r) => setTimeout(r, 200));

    const output = await getCommandOutput({ shell_id: bgResult.shell_id! });
    expect(output.success).toBe(true);
    expect(output.stdout).toContain('background');
  });

  it('should delegate killCommand', async () => {
    const bgResult = await runCommand({
      command: 'sleep 60',
      run_in_background: true,
    });

    const result = await killCommand({ shell_id: bgResult.shell_id! });
    expect(result.success).toBe(true);
  });

  it('should return error for unknown shell_id', async () => {
    const result = await getCommandOutput({ shell_id: 'unknown-id' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should cleanup all processes', async () => {
    await runCommand({ command: 'sleep 60', run_in_background: true });
    await runCommand({ command: 'sleep 60', run_in_background: true });

    cleanupAllProcesses();
    // No assertion needed — verifies no throw
  });
});
