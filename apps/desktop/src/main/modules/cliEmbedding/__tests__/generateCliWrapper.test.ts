import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every one of these is awaited (and `unlink` has `.catch` chained onto it), so
// the mocks have to resolve rather than return undefined.
const { chmodMock, mkdirMock, renameMock, symlinkMock, unlinkMock, writeFileMock } = vi.hoisted(
  () => {
    const resolved = () => vi.fn().mockResolvedValue(undefined);
    return {
      chmodMock: resolved(),
      mkdirMock: resolved(),
      renameMock: resolved(),
      symlinkMock: resolved(),
      unlinkMock: resolved(),
      writeFileMock: resolved(),
    };
  },
);

vi.mock('node:fs/promises', () => ({
  chmod: chmodMock,
  mkdir: mkdirMock,
  rename: renameMock,
  symlink: symlinkMock,
  unlink: unlinkMock,
  writeFile: writeFileMock,
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/apps/Product/resources/app',
    getPath: (name: string) => (name === 'exe' ? '/apps/Product/product.exe' : '/userData'),
    // Unpackaged: the packaged branch reads `process.resourcesPath`, which only
    // Electron defines. The wrapper body under test is identical either way.
    isPackaged: false,
  },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@/const/env', () => ({
  OFFICIAL_CLOUD_SERVER: 'https://server.example.com',
}));

vi.mock('@/env', () => ({
  getDesktopEnv: () => ({ DESKTOP_CLI_BIN_NAMES: 'brandcli,bc' }),
}));

const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });

const originalPlatform = process.platform;

/** The written wrapper body — `atomicWrite` writes to a temp path, then renames. */
const writtenContents = () => writeFileMock.mock.calls.map(([, content]) => content as string);

describe('generateCliWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => setPlatform(originalPlatform));

  describe.each([
    { alias: 2, platform: 'win32' as const },
    { alias: 1, platform: 'darwin' as const },
  ])('on $platform', ({ platform, alias }) => {
    it('defaults the server without overriding an explicit one', async () => {
      setPlatform(platform);
      const { generateCliWrapper } = await import('../generateCliWrapper');

      await generateCliWrapper();

      const contents = writtenContents();
      expect(contents).toHaveLength(alias);

      for (const content of contents) {
        // The failure this prevents: a wrapper carrying no environment at all,
        // which let the embedded CLI fall through to its bundled default host.
        expect(content).toContain('https://server.example.com');

        // And the opposite failure: assigning it unconditionally, which would
        // silently outrank `login --server <url>` and quietly talk to the wrong
        // deployment while appearing to succeed. Both shells must guard.
        const guarded =
          /if "%LOBEHUB_SERVER%"=="" set "LOBEHUB_SERVER=/.test(content) ||
          /: "\$\{LOBEHUB_SERVER:=/.test(content);
        expect(guarded).toBe(true);
      }

      // The wrapper must install the distribution's command names, not the
      // built-in ones — an app branded as X putting `lh` on the path collides
      // with a real upstream CLI on the same machine.
      const written = writeFileMock.mock.calls.map(([target]) => String(target));
      expect(written.some((f) => /brandcli/.test(f))).toBe(true);
      const basenames = written.map((f) => f.split(/[\\/]/).pop() ?? '');
      expect(basenames.some((n) => /^(?:lh|lobe|lobehub)(?:\.cmd)?(?:\.|$)/.test(n))).toBe(false);
    });
  });
});
