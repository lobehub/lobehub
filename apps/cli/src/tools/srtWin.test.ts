import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const existsSync = vi.fn(() => false);

vi.mock('node:fs', () => ({ default: { existsSync: (p: string) => existsSync(p) } }));

vi.mock('../constants/identity', () => ({ CLI_PRODUCT_NAME: 'Acme Work' }));

const { applySandboxHostPaths, bundledSrtWinPath } = await import('./srtWin');

const setPlatform = (platform: string, arch = 'x64') => {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
  Object.defineProperty(process, 'arch', { configurable: true, value: arch });
};

const realPlatform = process.platform;
const realArch = process.arch;

describe('bundled sandbox helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(false);
    delete process.env.LOBE_SRT_WIN_PATH;
    delete process.env.LOBE_SANDBOX_STAGING_NAME;
  });

  afterEach(() => {
    setPlatform(realPlatform, realArch);
    delete process.env.LOBE_SRT_WIN_PATH;
    delete process.env.LOBE_SANDBOX_STAGING_NAME;
  });

  it('finds a helper shipped beside the bundle', () => {
    setPlatform('win32', 'x64');
    existsSync.mockImplementation((p: string) => p.endsWith(path.join('x64', 'srt-win.exe')));

    const found = bundledSrtWinPath();
    expect(found).toBeDefined();
    expect(found).toContain(path.join('vendor', 'srt-win', 'x64', 'srt-win.exe'));
  });

  it('picks the path for the running architecture', () => {
    setPlatform('win32', 'arm64');
    existsSync.mockReturnValue(true);

    expect(bundledSrtWinPath()).toContain(path.join('srt-win', 'arm64'));
  });

  /**
   * Upstream ships no helper, so every one of these must stay undefined —
   * a build that vendors nothing has to behave exactly as it did before.
   */
  it('returns nothing when this build ships no helper', () => {
    setPlatform('win32', 'x64');
    existsSync.mockReturnValue(false);

    expect(bundledSrtWinPath()).toBeUndefined();
  });

  it('returns nothing off Windows, or on an architecture with no prebuilt', () => {
    existsSync.mockReturnValue(true);

    setPlatform('darwin', 'x64');
    expect(bundledSrtWinPath()).toBeUndefined();

    setPlatform('linux', 'x64');
    expect(bundledSrtWinPath()).toBeUndefined();

    setPlatform('win32', 'ia32');
    expect(bundledSrtWinPath()).toBeUndefined();
  });
});

describe('applySandboxHostPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(false);
    delete process.env.LOBE_SRT_WIN_PATH;
    delete process.env.LOBE_SANDBOX_STAGING_NAME;
  });

  afterEach(() => {
    setPlatform(realPlatform, realArch);
    delete process.env.LOBE_SRT_WIN_PATH;
    delete process.env.LOBE_SANDBOX_STAGING_NAME;
  });

  it('names the staging directory after the product', () => {
    applySandboxHostPaths();

    expect(process.env.LOBE_SANDBOX_STAGING_NAME).toBe('Acme Work');
  });

  it('points the backend at the bundled helper', () => {
    setPlatform('win32', 'x64');
    existsSync.mockReturnValue(true);

    applySandboxHostPaths();

    expect(process.env.LOBE_SRT_WIN_PATH).toContain('srt-win.exe');
  });

  /**
   * The documented override has to keep working, or an operator placing the
   * helper themselves would find the one supported escape hatch ignored.
   */
  it('never overrides a value already set', () => {
    setPlatform('win32', 'x64');
    existsSync.mockReturnValue(true);
    process.env.LOBE_SRT_WIN_PATH = String.raw`D:\custom\srt-win.exe`;
    process.env.LOBE_SANDBOX_STAGING_NAME = 'Chosen';

    applySandboxHostPaths();

    expect(process.env.LOBE_SRT_WIN_PATH).toBe(String.raw`D:\custom\srt-win.exe`);
    expect(process.env.LOBE_SANDBOX_STAGING_NAME).toBe('Chosen');
  });

  it('leaves the helper path unset when this build ships none', () => {
    setPlatform('win32', 'x64');
    existsSync.mockReturnValue(false);

    applySandboxHostPaths();

    expect(process.env.LOBE_SRT_WIN_PATH).toBeUndefined();
  });
});
