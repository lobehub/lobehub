import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPathExistsSync = vi.fn();

vi.mock('electron', () => ({
  app: {
    isReady: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
  },
  protocol: {
    handle: vi.fn(),
  },
}));

vi.mock('fs-extra', () => ({
  pathExistsSync: (...args: any[]) => mockPathExistsSync(...args),
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

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('RendererUrlManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExistsSync.mockReset();
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

      expect(resolved).toBe('/mock/export/out/en-US__0__light.txt');
    });

    it('should fall back to index.html for app routes', async () => {
      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();

      mockPathExistsSync.mockImplementation(
        (p: string) => p === '/mock/export/out/apps/desktop/index.html',
      );

      const resolved = await manager.resolveRendererFilePath(new URL('app://renderer/settings'));

      expect(resolved).toBe('/mock/export/out/apps/desktop/index.html');
    });
  });

  describe('configureRendererLoader (dev mode)', () => {
    it('should use ELECTRON_RENDERER_URL when available in dev mode', async () => {
      mockIsDev = true;
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';

      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      manager.configureRendererLoader();

      expect(manager.buildRendererUrl('/')).toBe('http://localhost:5173/');
      expect(manager.buildRendererUrl('/settings')).toBe('http://localhost:5173/settings');
    });

    it('should fall back to protocol handler when ELECTRON_RENDERER_URL is not set', async () => {
      mockIsDev = true;

      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      mockPathExistsSync.mockReturnValue(true);
      manager.configureRendererLoader();

      expect(manager.buildRendererUrl('/')).toBe('app://renderer/');
    });

    it('should use protocol handler when DESKTOP_RENDERER_STATIC is enabled regardless of ELECTRON_RENDERER_URL', async () => {
      mockIsDev = true;
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';

      const { getDesktopEnv } = await import('@/env');
      vi.mocked(getDesktopEnv).mockReturnValue({ DESKTOP_RENDERER_STATIC: true } as any);

      const { RendererUrlManager } = await import('../RendererUrlManager');
      const manager = new RendererUrlManager();
      mockPathExistsSync.mockReturnValue(true);
      manager.configureRendererLoader();

      expect(manager.buildRendererUrl('/')).toBe('app://renderer/');
    });
  });
});
