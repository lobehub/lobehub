import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RendererUrlManager } from '../RendererUrlManager';

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
  nextExportDir: '/mock/export/out',
}));

vi.mock('@/const/env', () => ({
  isDev: false,
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
  let manager: RendererUrlManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExistsSync.mockReset();
    manager = new RendererUrlManager();
  });

  describe('resolveRendererFilePath', () => {
    it('should resolve asset requests directly', async () => {
      mockPathExistsSync.mockImplementation(
        (p: string) => p === '/mock/export/out/en-US__0__light.txt',
      );

      const resolved = await manager.resolveRendererFilePath(
        new URL('app://next/en-US__0__light.txt'),
      );

      expect(resolved).toBe('/mock/export/out/en-US__0__light.txt');
    });

    it('should fall back to index.html for app routes', async () => {
      mockPathExistsSync.mockImplementation((p: string) => p === '/mock/export/out/index.html');

      const resolved = await manager.resolveRendererFilePath(new URL('app://next/settings'));

      expect(resolved).toBe('/mock/export/out/index.html');
    });
  });
});
