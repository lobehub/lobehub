import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeSandboxCapability } from '../capability';

const {
  mockCheckDependencies,
  mockGetSrtWinPath,
  mockIsSupportedPlatform,
  mockResolveEffectiveSrtWin,
  mockResolveSrtWin,
  mockUserStatus,
  mockWfpStatus,
} = vi.hoisted(() => ({
  mockCheckDependencies: vi.fn(),
  mockGetSrtWinPath: vi.fn(),
  mockIsSupportedPlatform: vi.fn(),
  mockResolveEffectiveSrtWin: vi.fn(),
  mockResolveSrtWin: vi.fn(),
  mockUserStatus: vi.fn(),
  mockWfpStatus: vi.fn(),
}));

vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: {
    checkDependencies: mockCheckDependencies,
    isSupportedPlatform: mockIsSupportedPlatform,
  },
  getSrtWinPath: mockGetSrtWinPath,
  getWindowsSandboxUserStatus: mockUserStatus,
  getWindowsWfpStatus: mockWfpStatus,
  resolveSrtWin: mockResolveSrtWin,
  windowsInstallInstructions: () => 'run the installer',
}));

vi.mock('../srtWinStaging', () => ({
  resolveEffectiveSrtWin: mockResolveEffectiveSrtWin,
}));

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
};

describe('probeSandboxCapability', () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupportedPlatform.mockReturnValue(true);
    mockResolveEffectiveSrtWin.mockReturnValue('C:\\ProgramData\\LobeHub\\srt-win.exe');
    mockResolveSrtWin.mockImplementation((cfg: { path: string }) => ({
      exe: cfg.path,
      prependArgs: ['--srt-win'],
    }));
    mockUserStatus.mockReturnValue({ credPresent: true, provisioned: true });
    mockWfpStatus.mockReturnValue({ filters: 4, state: 'installed' });
    mockCheckDependencies.mockReturnValue({ errors: [], warnings: [] });
  });

  afterEach(() => setPlatform(realPlatform));

  describe('windows', () => {
    beforeEach(() => setPlatform('win32'));

    it('checks the helper this app ships instead of the backend-guessed path', async () => {
      // The regression: the backend resolves its helper relative to its own
      // package directory, which lands inside app.asar once bundled — a
      // correctly installed app then reported "srt-win.exe not found".
      const capability = await probeSandboxCapability();

      expect(capability.available).toBe(true);
      expect(mockCheckDependencies).not.toHaveBeenCalled();
      expect(mockResolveSrtWin).toHaveBeenCalledWith({
        path: 'C:\\ProgramData\\LobeHub\\srt-win.exe',
      });
      expect(mockUserStatus).toHaveBeenCalledWith({
        srtWin: { exe: 'C:\\ProgramData\\LobeHub\\srt-win.exe', prependArgs: ['--srt-win'] },
      });
    });

    it('reports unavailable when no helper can be found', async () => {
      mockResolveEffectiveSrtWin.mockReturnValue(undefined);

      const capability = await probeSandboxCapability();

      expect(capability.available).toBe(false);
      expect(capability.reason).toContain('Sandbox helper not found');
      expect(mockUserStatus).not.toHaveBeenCalled();
    });

    it('reports unavailable while the sandbox account is not provisioned', async () => {
      // This is the state the Set-up button exists to fix, so it must be
      // distinguishable from a missing binary, which that button cannot fix.
      mockUserStatus.mockReturnValue({ credPresent: false, provisioned: false });

      const capability = await probeSandboxCapability();

      expect(capability.available).toBe(false);
      expect(capability.reason).toContain('not provisioned');
    });

    it('treats unreadable filter enumeration as available', async () => {
      // BFE enumeration is admin-gated; the behavioural egress check at
      // initialize() is what actually fails closed, so `cannot-read` from a
      // non-elevated probe must not disable the option.
      mockWfpStatus.mockReturnValue({ filters: 0, state: 'cannot-read' });

      expect((await probeSandboxCapability()).available).toBe(true);
    });

    it('reports unavailable when the filters are absent', async () => {
      mockWfpStatus.mockReturnValue({ filters: 0, state: 'absent' });

      const capability = await probeSandboxCapability();

      expect(capability.available).toBe(false);
      expect(capability.reason).toContain('WFP filters');
    });
  });

  describe('other platforms', () => {
    beforeEach(() => setPlatform('darwin'));

    it('keeps using the backend check, which resolves nothing app-relative', async () => {
      const capability = await probeSandboxCapability();

      expect(capability.available).toBe(true);
      expect(mockCheckDependencies).toHaveBeenCalled();
      expect(mockResolveEffectiveSrtWin).not.toHaveBeenCalled();
    });

    it('surfaces backend dependency errors', async () => {
      mockCheckDependencies.mockReturnValue({ errors: ['bubblewrap not found'], warnings: [] });

      const capability = await probeSandboxCapability();

      expect(capability.available).toBe(false);
      expect(capability.reason).toContain('bubblewrap not found');
    });
  });

  it('reports unavailable on a platform the backend does not support', async () => {
    mockIsSupportedPlatform.mockReturnValue(false);

    expect((await probeSandboxCapability()).available).toBe(false);
  });
});
