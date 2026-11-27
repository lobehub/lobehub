import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import BinaryCtr from '../BinaryCtr';

const { detectCliSpy, detectDshSpy, invalidateSpy } = vi.hoisted(() => ({
  detectCliSpy: vi.fn(async () => ({ available: false })),
  detectDshSpy: vi.fn(async () => ({ available: false })),
  invalidateSpy: vi.fn(),
}));

vi.mock('electron', () => ({ app: { getPath: vi.fn() }, ipcMain: { handle: vi.fn() } }));
vi.mock('@/modules/binaries', () => ({
  detectHeterogeneousCliCommand: detectCliSpy,
  invalidateLoginShellPathCache: invalidateSpy,
}));
vi.mock('@lobechat/heterogeneous-agents/spawn', async (importActual) => ({
  ...(await importActual<object>()),
  detectDshCommand: detectDshSpy,
}));

describe('BinaryCtr list scans', () => {
  const managerDetect = vi.fn(async () => ({ available: false }));
  const controller = () =>
    new BinaryCtr({ binaryManager: { detect: managerDetect } } as unknown as App);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the environment once per scan, keeping WSL, and never boots a distro', async () => {
    const ctr = controller();
    const scan = { id: 'scan-1' };

    await Promise.all([
      ctr.detectHeterogeneousAgentCommand({ agentType: 'codex', command: 'codex', scan }),
      ctr.detectHeterogeneousAgentCommand({ agentType: 'claude-code', command: 'claude', scan }),
      ctr.detectHeterogeneousAgentCommand({ agentType: 'deepseek-harness', command: 'dsh', scan }),
      ctr.detectHeterogeneousAgentCommand({ agentType: 'codex', command: 'codex-beta', scan }),
    ]);

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ keepWslCache: true });
    expect(managerDetect).toHaveBeenCalledWith('codex', true, {
      refreshEnvironment: false,
      wslScope: 'running',
    });
    expect(detectDshSpy).toHaveBeenCalledWith('dsh', undefined, { wslScope: 'running' });
    expect(detectCliSpy).toHaveBeenCalledWith('codex', 'codex-beta', undefined, {
      wslScope: 'running',
    });
  });

  it('lets a Rescan drop what WSL told it and start stopped distros', async () => {
    const ctr = controller();

    await ctr.detectHeterogeneousAgentCommand({
      agentType: 'codex',
      command: 'codex',
      scan: { id: 'scan-2', rescan: true },
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ keepWslCache: false });
    expect(managerDetect).toHaveBeenCalledWith('codex', true, {
      refreshEnvironment: false,
      wslScope: undefined,
    });
  });

  it('keeps a one-off check fully fresh', async () => {
    await controller().detectHeterogeneousAgentCommand({ agentType: 'codex', command: 'codex' });

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(managerDetect).toHaveBeenCalledWith('codex', true, {
      refreshEnvironment: true,
      wslScope: undefined,
    });
  });
});
