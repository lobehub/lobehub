import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RendererProtocolManager } from '../RendererProtocolManager';

const { mockApp, mockPathExistsSync, mockProtocol, mockReadFile, mockStat, protocolHandlerRef } =
  vi.hoisted(() => {
    const protocolHandlerRef = { current: null as any };

    return {
      mockApp: {
        isReady: vi.fn().mockReturnValue(true),
        whenReady: vi.fn().mockResolvedValue(undefined),
      },
      mockPathExistsSync: vi.fn().mockReturnValue(true),
      mockProtocol: {
        handle: vi.fn((_scheme: string, handler: any) => {
          protocolHandlerRef.current = handler;
        }),
      },
      mockReadFile: vi.fn(),
      mockStat: vi.fn(),
      protocolHandlerRef,
    };
  });

vi.mock('electron', () => ({
  app: mockApp,
  protocol: mockProtocol,
}));

vi.mock('fs-extra', () => ({
  pathExistsSync: mockPathExistsSync,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  stat: mockStat,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('RendererProtocolManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    protocolHandlerRef.current = null;
    mockApp.isReady.mockReturnValue(true);
    mockPathExistsSync.mockReturnValue(true);
    mockStat.mockImplementation(async () => ({ size: 1024 }));
  });

  afterEach(() => {
    protocolHandlerRef.current = null;
  });

  it('should fall back to entry HTML when resolve returns 404.html for non-asset routes', async () => {
    const resolveRendererFilePath = vi.fn(async (url: URL) => {
      if (url.pathname === '/missing') return '/export/404.html';
      if (url.pathname === '/') return '/export/index.html';
      return null;
    });
    mockReadFile.mockImplementation(async (path: string) => Buffer.from(`content:${path}`));

    const manager = new RendererProtocolManager({
      nextExportDir: '/export',
      resolveRendererFilePath,
    });

    manager.registerHandler();
    expect(mockProtocol.handle).toHaveBeenCalled();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://next/missing',
    } as any);
    const body = await response.text();

    expect(resolveRendererFilePath).toHaveBeenCalledTimes(2);
    expect(resolveRendererFilePath.mock.calls[0][0].pathname).toBe('/missing');
    expect(resolveRendererFilePath.mock.calls[1][0].pathname).toBe('/');

    expect(mockReadFile).toHaveBeenCalledWith('/export/index.html');
    expect(body).toContain('/export/index.html');
    expect(response.status).toBe(200);
  });

  it('should serve 404.html when explicitly requested', async () => {
    const resolveRendererFilePath = vi.fn(async (url: URL) => {
      if (url.pathname === '/404.html') return '/export/404.html';
      if (url.pathname === '/') return '/export/index.html';
      return null;
    });
    mockReadFile.mockImplementation(async (path: string) => Buffer.from(`content:${path}`));

    const manager = new RendererProtocolManager({
      nextExportDir: '/export',
      resolveRendererFilePath,
    });

    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://next/404.html',
    } as any);

    expect(resolveRendererFilePath).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledWith('/export/404.html');
    expect(response.status).toBe(200);
  });

  it('should return 404 for missing asset requests without fallback', async () => {
    const resolveRendererFilePath = vi.fn(async (_url: URL) => null);

    const manager = new RendererProtocolManager({
      nextExportDir: '/export',
      resolveRendererFilePath,
    });

    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const response = await handler({ url: 'app://next/logo.png' } as any);

    expect(resolveRendererFilePath).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });

  it('should support Range requests for media assets', async () => {
    const resolveRendererFilePath = vi.fn(async (_url: URL) => '/export/intro-video.mp4');
    const payload = Buffer.from('0123456789');

    mockStat.mockImplementation(async () => ({ size: payload.length }));
    mockReadFile.mockImplementation(async () => payload);

    const manager = new RendererProtocolManager({
      nextExportDir: '/export',
      resolveRendererFilePath,
    });

    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers({ Range: 'bytes=0-1' }),
      method: 'GET',
      url: 'app://next/_next/static/media/intro-video.mp4',
    } as any);

    expect(response.status).toBe(206);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Range')).toBe('bytes 0-1/10');
    expect(response.headers.get('Content-Length')).toBe('2');
    expect(response.headers.get('Content-Type')).toBe('video/mp4');

    const buf = Buffer.from(await response.arrayBuffer());
    expect(buf.toString()).toBe('01');
  });
});
