import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPathExistsSync = vi.fn();
const mockProtocolHandle = vi.fn();

vi.mock('electron', () => ({
  app: {
    isReady: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
  },
  net: {
    fetch: vi.fn(),
  },
  protocol: {
    handle: mockProtocolHandle,
  },
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: any[]) => mockPathExistsSync(...args),
}));

vi.mock('@/const/dir', () => ({
  rendererDir: '/mock/export/out',
}));

let mockIsDev = false;

vi.mock('@/const/env', () => ({
  get isDev() {
    return mockIsDev;
  },
}));

vi.mock('@/env', () => ({
  getDesktopEnv: vi.fn(() => ({ DESKTOP_RENDERER_STATIC: false })),
}));

describe('RendererUrlManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExistsSync.mockReset();
    mockProtocolHandle.mockReset();
    mockIsDev = false;
    delete process.env['ELECTRON_RENDERER_URL'];
  });

  describe('resolveRendererFilePath', () => {
    it('should resolve asset requests directly', async () => {
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();

      mockPathExistsSync.mockImplementation(
        (p: string) => p === '/mock/export/out/en-US__0__light.txt',
      );

      const resolved = await manager.resolveRendererFilePath(
        new URL('app://renderer/en-US__0__light.txt'),
      );

      expect(resolved).toEqual({
        filePath: '/mock/export/out/en-US__0__light.txt',
        name: 'en-US__0__light.txt',
      });
    });

    it('should fall back to index.html for app routes', async () => {
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();

      mockPathExistsSync.mockImplementation(
        (p: string) => p === '/mock/export/out/apps/desktop/index.html',
      );

      const resolved = await manager.resolveRendererFilePath(new URL('app://renderer/settings'));

      expect(resolved).toEqual({
        filePath: '/mock/export/out/apps/desktop/index.html',
        name: 'index.html',
      });
    });
  });

  describe('setActiveRenderer', () => {
    const otaSource = {
      resolve: (relPath: string) =>
        ['apps/desktop/index.html', 'assets/new.js'].includes(relPath) ? `/ota/${relPath}` : null,
    };

    it('serves an OTA source and keeps old chunks reachable from the previous source', async () => {
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      mockPathExistsSync.mockImplementation((p: string) => p === '/mock/export/out/assets/old.js');

      manager.setActiveRenderer(otaSource);

      expect(manager.getActiveRenderer()).toBe(otaSource);
      expect(await manager.resolveRendererFilePath(new URL('app://renderer/settings'))).toEqual({
        filePath: '/ota/apps/desktop/index.html',
        name: 'index.html',
      });
      expect(
        await manager.resolveRendererFilePath(new URL('app://renderer/assets/new.js')),
      ).toEqual({ filePath: '/ota/assets/new.js', name: 'new.js' });
      expect(
        await manager.resolveRendererFilePath(new URL('app://renderer/assets/old.js')),
      ).toEqual({ filePath: '/mock/export/out/assets/old.js', name: 'old.js' });
    });

    it('keeps the running renderer when the source has no entry HTML', async () => {
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      const running = manager.getActiveRenderer();

      manager.setActiveRenderer({ resolve: () => null });

      expect(manager.getActiveRenderer()).toBe(running);
    });

    it('returns to the running renderer for null', async () => {
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      const running = manager.getActiveRenderer();

      manager.setActiveRenderer(otaSource);
      manager.setActiveRenderer(null);

      expect(manager.getActiveRenderer()).toBe(running);
    });
  });

  describe('buildRendererUrl', () => {
    it('always returns app://renderer regardless of dev/prod', async () => {
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const prodManager = new RendererUrlManager();
      expect(prodManager.buildRendererUrl('/')).toBe('app://renderer/');
      expect(prodManager.buildRendererUrl('/settings')).toBe('app://renderer/settings');

      mockIsDev = true;
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';
      const devManager = new RendererUrlManager();
      expect(devManager.buildRendererUrl('/')).toBe('app://renderer/');
      expect(devManager.buildRendererUrl('/settings')).toBe('app://renderer/settings');
    });

    it('prefixes a slash when the input lacks one', async () => {
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      expect(manager.buildRendererUrl('settings')).toBe('app://renderer/settings');
    });
  });

  describe('configureRendererLoader', () => {
    it('registers the app:// protocol handler in prod', async () => {
      mockIsDev = false;
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      manager.configureRendererLoader();

      expect(mockProtocolHandle).toHaveBeenCalledTimes(1);
      expect(mockProtocolHandle.mock.calls[0][0]).toBe('app');
    });

    it('registers the app:// protocol handler in dev (Vite fallback)', async () => {
      mockIsDev = true;
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';

      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      manager.configureRendererLoader();

      expect(mockProtocolHandle).toHaveBeenCalledTimes(1);
      expect(mockProtocolHandle.mock.calls[0][0]).toBe('app');
    });

    it('still registers in dev when ELECTRON_RENDERER_URL is missing (static fallback)', async () => {
      mockIsDev = true;
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      manager.configureRendererLoader();

      expect(mockProtocolHandle).toHaveBeenCalledTimes(1);
    });

    it('uses static fallback when DESKTOP_RENDERER_STATIC overrides ELECTRON_RENDERER_URL', async () => {
      mockIsDev = true;
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';

      const { getDesktopEnv } = await import('@/env');
      vi.mocked(getDesktopEnv).mockReturnValue({ DESKTOP_RENDERER_STATIC: true } as any);

      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      manager.configureRendererLoader();

      expect(manager.buildRendererUrl('/')).toBe('app://renderer/');
      expect(mockProtocolHandle).toHaveBeenCalledTimes(1);
    });
  });
});
