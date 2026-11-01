import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectSystemInfo, probeNativeRuntimes } from './systemInfo';

const codexProbe = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn<() => Promise<{ userAgent: string }>>(),
  options: vi.fn(),
  resolve: vi.fn<() => Promise<{ command: string; pathEnv?: string }>>(),
}));
vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: codexProbe.resolve,
}));
vi.mock('@lobechat/heterogeneous-agents/spawn', () => ({
  CodexAppServerClient: class {
    constructor(options: object) {
      codexProbe.options(options);
    }
    close = codexProbe.close;
    connect = codexProbe.connect;
  },
}));

const uncachedProbe = { get: probeNativeRuntimes, invalidate: () => {} };

describe('probeNativeRuntimes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codexProbe.connect.mockResolvedValue({ userAgent: 'codex/0.160.0' });
    codexProbe.resolve.mockResolvedValue({ command: '/resolved/codex', pathEnv: '/resolved/bin' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advertises native Codex after a successful handshake on the resolved binary', async () => {
    await expect(probeNativeRuntimes()).resolves.toEqual(['codex-app-server-v1']);
    /** @example Resolution PATH is carried into the exact probed executable. */
    expect(codexProbe.options).toHaveBeenCalledWith(
      expect.objectContaining({
        commandPath: '/resolved/codex',
        env: expect.objectContaining({ PATH: '/resolved/bin' }),
      }),
    );
    expect(codexProbe.close).toHaveBeenCalledOnce();
  });

  /** @example Unsupported Codex keeps ordinary device sends on the existing exec runtime. */
  it('does not advertise native Codex when the binary rejects initialization', async () => {
    // ROOT CAUSE:
    // collectSystemInfo unconditionally advertised codex-app-server-v1, so even an
    // exec-only binary was selected for native ordinary sends and failed before answering.
    // Native support must come from the resolved binary's actual handshake.
    codexProbe.connect.mockRejectedValueOnce(new Error('unsupported app-server'));
    /** @example Unavailable native capability preserves the successful system-info response. */
    await expect(collectSystemInfo(uncachedProbe)).resolves.toMatchObject({
      supportedAgentRuntimes: [],
    });
    /** @example A failed probe does not leave its subprocess alive. */
    expect(codexProbe.close).toHaveBeenCalledOnce();
  });

  /** @example A handshake timeout must not stall device discovery or advertise support. */
  it('bounds native Codex probing and closes the stalled client', async () => {
    vi.useFakeTimers();
    codexProbe.connect.mockImplementationOnce(() => new Promise(() => {}));
    const systemInfo = collectSystemInfo(uncachedProbe);
    await vi.advanceTimersByTimeAsync(6000);
    /** @example A stalled app-server falls back to the existing capability set. */
    expect((await systemInfo).supportedAgentRuntimes).toEqual([]);
    /** @example Timeout releases the owned native process. */
    expect(codexProbe.close).toHaveBeenCalledOnce();
  });
});
