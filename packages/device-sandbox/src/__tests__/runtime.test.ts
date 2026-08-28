import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SrtSandboxRuntime } from '../runtime';
import type { SandboxCapability, SandboxPolicy } from '../types';

const { mockCleanup, mockGetConfig, mockInitialize, mockIsEnabled, mockReset, mockWrap } =
  vi.hoisted(() => ({
    mockCleanup: vi.fn(),
    mockGetConfig: vi.fn(),
    mockInitialize: vi.fn(),
    mockIsEnabled: vi.fn(),
    mockReset: vi.fn(),
    mockWrap: vi.fn(),
  }));

vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: {
    cleanupAfterCommand: mockCleanup,
    getConfig: mockGetConfig,
    initialize: mockInitialize,
    isSandboxingEnabled: mockIsEnabled,
    reset: mockReset,
    wrapWithSandboxArgv: mockWrap,
  },
  getSrtWinPath: () => 'C:\\packaged\\srt-win.exe',
}));

const capability: SandboxCapability = {
  available: true,
  backend: 'srt',
  networkIsolation: true,
};

const policyFor = (root: string): SandboxPolicy => ({
  allowNetwork: false,
  onUnavailable: 'deny',
  writableRoots: [root],
});

// The runtime hashes the config the backend receives, so a stable stand-in for
// `createSrtConfig` keeps these tests about policy switching rather than config
// shape. Roots are passed through unnormalized on purpose — `normalizeSandboxPolicy`
// requires the paths to exist on disk, which is not what is under test here.
vi.mock('../srt', () => ({
  createSrtConfig: (policy: SandboxPolicy) => ({ roots: policy.writableRoots }),
}));

describe('SrtSandboxRuntime policy switching', () => {
  let runtime: SrtSandboxRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new SrtSandboxRuntime();
    mockInitialize.mockResolvedValue(undefined);
    mockIsEnabled.mockReturnValue(true);
    mockReset.mockResolvedValue(undefined);
    mockWrap.mockResolvedValue({ argv: ['wrapper', '-c', 'cmd'], env: {} });
    mockGetConfig.mockImplementation(() => mockInitialize.mock.lastCall?.[0]);
  });

  const launch = (root: string) =>
    runtime.createLaunchPlan(
      { command: { args: ['-c', 'echo hi'], cmd: '/bin/sh' }, cwd: root, policy: policyFor(root) },
      capability,
    );

  it('reuses the session when the policy is unchanged', async () => {
    const first = await launch('/project-a');
    first.release?.();
    const second = await launch('/project-a');
    second.release?.();

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('re-initializes when the policy changes and nothing is running', async () => {
    // Switching agents, opening another project, or flipping the network
    // toggle all change the policy. Refusing them would make the sandbox
    // usable exactly once per app launch.
    const first = await launch('/project-a');
    first.release?.();

    const second = await launch('/project-b');
    second.release?.();

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(2);
    expect(mockInitialize.mock.calls[1][0]).toEqual({ roots: ['/project-b'] });
  });

  it('refuses to swap the policy out from under a running command', async () => {
    // The fence a live command is running inside must not be replaced.
    await launch('/project-a'); // deliberately not released

    await expect(launch('/project-b')).rejects.toMatchObject({
      code: 'SANDBOX_POLICY_CONFLICT',
    });
    expect(mockReset).not.toHaveBeenCalled();
  });
});
