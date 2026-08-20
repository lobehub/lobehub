import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandCore = vi.fn(async () => ({ success: true }));
const createLocalSandboxPolicy = vi.fn((cwd: string, options?: { allowNetwork?: boolean }) => ({
  allowNetwork: options?.allowNetwork ?? false,
  onUnavailable: 'deny',
  writableRoots: [cwd],
}));
const probeSandboxCapability = vi.fn(async () => ({ available: true }) as any);

vi.mock('@lobechat/local-file-shell', () => ({
  ShellProcessManager: class {
    cleanupAll() {}
    getOutput() {}
    kill() {}
  },
  runCommand: (...args: unknown[]) => runCommandCore(...(args as [])),
}));

vi.mock('@lobechat/device-sandbox', () => ({
  createLocalSandboxPolicy: (...args: unknown[]) => createLocalSandboxPolicy(...(args as [any])),
  probeSandboxCapability: () => probeSandboxCapability(),
}));

const resolveCommandMode = vi.fn(() => 'auto');
const resolveSandboxNetwork = vi.fn(() => false);

vi.mock('../settings', () => ({
  resolveCommandMode: () => resolveCommandMode(),
  resolveSandboxNetwork: () => resolveSandboxNetwork(),
}));

vi.mock('./sandboxWorkspace', () => ({
  ensureSandboxWorkspace: () => '/tmp/device-sandbox-workspace',
}));

vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { resetSandboxCapabilityCache, runCommand } = await import('./shell');

const policyOf = () => runCommandCore.mock.calls.at(-1)?.[1] as { sandboxPolicy?: unknown };

/**
 * The gap these cover: the server sets `sandbox` on the tool-call args from the
 * agent's execution environment and the desktop honours it, but a CLI-connected
 * device modelled no such field — so a run configured to be fenced executed
 * unfenced on this host and reported success. Nothing between the picker and
 * the spawn could notice.
 */
describe('CLI sandbox dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSandboxCapabilityCache();
    resolveCommandMode.mockReturnValue('auto');
    resolveSandboxNetwork.mockReturnValue(false);
    probeSandboxCapability.mockResolvedValue({ available: true } as any);
    runCommandCore.mockResolvedValue({ success: true });
  });

  it('runs unfenced, exactly as before, when nothing asks for a fence', async () => {
    await runCommand({ command: 'echo hi' });

    expect(runCommandCore).toHaveBeenCalledTimes(1);
    expect(policyOf().sandboxPolicy).toBeUndefined();
  });

  it('fences a run the server marked sandboxed', async () => {
    await runCommand({ command: 'echo hi', cwd: '/work', sandbox: true });

    expect(createLocalSandboxPolicy).toHaveBeenCalledWith('/work', { allowNetwork: false });
    expect(policyOf().sandboxPolicy).toBeDefined();
  });

  it('passes the run’s network scope into the policy', async () => {
    await runCommand({ command: 'npm i', cwd: '/work', sandbox: true, sandboxNetwork: true });

    expect(createLocalSandboxPolicy).toHaveBeenCalledWith('/work', { allowNetwork: true });
  });

  it('refuses rather than running unfenced when the host cannot sandbox', async () => {
    probeSandboxCapability.mockResolvedValue({ available: false, reason: 'no backend' } as any);

    const result = await runCommand({ command: 'rm -rf /', cwd: '/work', sandbox: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no backend');
    expect(runCommandCore).not.toHaveBeenCalled();
  });

  it('refuses rather than running unfenced when the probe itself throws', async () => {
    probeSandboxCapability.mockRejectedValue(new Error('backend exploded'));

    const result = await runCommand({ command: 'echo hi', cwd: '/work', sandbox: true });

    expect(result.success).toBe(false);
    expect(runCommandCore).not.toHaveBeenCalled();
  });

  it('substitutes its own workspace when a fenced run arrives without one', async () => {
    await runCommand({ command: 'echo hi', sandbox: true });

    expect(createLocalSandboxPolicy).toHaveBeenCalledWith('/tmp/device-sandbox-workspace', {
      allowNetwork: false,
    });
    expect(runCommandCore.mock.calls.at(-1)?.[0]).toMatchObject({
      cwd: '/tmp/device-sandbox-workspace',
    });
  });

  describe('command-mode', () => {
    it('fences an unmarked run when the device requires it', async () => {
      resolveCommandMode.mockReturnValue('sandbox');

      await runCommand({ command: 'echo hi', cwd: '/work' });

      expect(policyOf().sandboxPolicy).toBeDefined();
    });

    it('applies the device network setting only to a fence it imposed itself', async () => {
      resolveCommandMode.mockReturnValue('sandbox');
      resolveSandboxNetwork.mockReturnValue(true);

      await runCommand({ command: 'npm i', cwd: '/work' });
      expect(createLocalSandboxPolicy).toHaveBeenLastCalledWith('/work', { allowNetwork: true });

      await runCommand({ command: 'npm i', cwd: '/work', sandbox: true, sandboxNetwork: false });
      expect(createLocalSandboxPolicy).toHaveBeenLastCalledWith('/work', { allowNetwork: false });
    });

    it('refuses a fenced run in host mode instead of downgrading it', async () => {
      resolveCommandMode.mockReturnValue('host');

      const result = await runCommand({ command: 'echo hi', cwd: '/work', sandbox: true });

      expect(result.success).toBe(false);
      expect(runCommandCore).not.toHaveBeenCalled();
    });

    it('still runs ordinary commands in host mode', async () => {
      resolveCommandMode.mockReturnValue('host');

      await runCommand({ command: 'echo hi', cwd: '/work' });

      expect(runCommandCore).toHaveBeenCalledTimes(1);
      expect(policyOf().sandboxPolicy).toBeUndefined();
    });
  });
});
