import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RendererProtocolManager,
  StaticRendererFallback,
  ViteRendererFallback,
} from '../RendererProtocolManager';

const {
  mockApp,
  mockFetch,
  mockPathExistsSync,
  mockProtocol,
  mockReadFile,
  mockStat,
  protocolHandlerRef,
} = vi.hoisted(() => {
  const protocolHandlerRef = { current: null as any };

  return {
    mockApp: {
      isReady: vi.fn().mockReturnValue(true),
      whenReady: vi.fn().mockResolvedValue(undefined),
    },
    mockFetch: vi.fn(),
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

vi.stubGlobal('fetch', mockFetch);

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

describe('RendererProtocolManager + StaticRendererFallback', () => {
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

  const buildStaticManager = (resolve: (url: URL) => Promise<string | null>) => {
    const fallback = new StaticRendererFallback('/export', resolve);
    const manager = new RendererProtocolManager({ fallback });
    manager.registerHandler();
    return manager;
  };

  it('falls back to entry HTML when resolve returns 404.html for non-asset routes', async () => {
    const resolveRendererFilePath = vi.fn(async (url: URL) => {
      if (url.pathname === '/missing') return '/export/404.html';
      if (url.pathname === '/') return '/export/index.html';
      return null;
    });
    mockReadFile.mockImplementation(async (path: string) => Buffer.from(`content:${path}`));

    buildStaticManager(resolveRendererFilePath);
    expect(mockProtocol.handle).toHaveBeenCalled();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://renderer/missing',
    } as any);
    const body = await response.text();

    expect(resolveRendererFilePath).toHaveBeenCalledTimes(2);
    expect(resolveRendererFilePath.mock.calls[0][0].pathname).toBe('/missing');
    expect(resolveRendererFilePath.mock.calls[1][0].pathname).toBe('/');

    expect(mockReadFile).toHaveBeenCalledWith('/export/index.html');
    expect(body).toContain('/export/index.html');
    expect(response.status).toBe(200);
  });

  it('serves 404.html when explicitly requested', async () => {
    const resolveRendererFilePath = vi.fn(async (url: URL) => {
      if (url.pathname === '/404.html') return '/export/404.html';
      if (url.pathname === '/') return '/export/index.html';
      return null;
    });
    mockReadFile.mockImplementation(async (path: string) => Buffer.from(`content:${path}`));

    buildStaticManager(resolveRendererFilePath);
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://renderer/404.html',
    } as any);

    expect(resolveRendererFilePath).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledWith('/export/404.html');
    expect(response.status).toBe(200);
  });

  it('returns 404 for missing asset requests without fallback', async () => {
    const resolveRendererFilePath = vi.fn(async (_url: URL) => null);

    buildStaticManager(resolveRendererFilePath);
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://renderer/logo.png',
    } as any);

    expect(resolveRendererFilePath).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });

  it('supports Range requests for media assets', async () => {
    const resolveRendererFilePath = vi.fn(async (_url: URL) => '/export/intro-video.mp4');
    const payload = Buffer.from('0123456789');

    mockStat.mockImplementation(async () => ({ size: payload.length }));
    mockReadFile.mockImplementation(async () => payload);

    buildStaticManager(resolveRendererFilePath);
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers({ Range: 'bytes=0-1' }),
      method: 'GET',
      url: 'app://renderer/assets/intro-video.mp4',
    } as any);

    expect(response.status).toBe(206);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Range')).toBe('bytes 0-1/10');
    expect(response.headers.get('Content-Length')).toBe('2');
    expect(response.headers.get('Content-Type')).toBe('video/mp4');

    const buf = Buffer.from(await response.arrayBuffer());
    expect(buf.toString()).toBe('01');
  });

  it('runs interceptors before the fallback and short-circuits on first non-null Response', async () => {
    const resolveRendererFilePath = vi.fn(async () => '/export/index.html');
    mockReadFile.mockImplementation(async () => Buffer.from('static'));

    const fallback = new StaticRendererFallback('/export', resolveRendererFilePath);
    const manager = new RendererProtocolManager({ fallback });

    manager.addRequestInterceptor(async () => null);
    manager.addRequestInterceptor(async (request) =>
      new URL(request.url).pathname === '/trpc/hello'
        ? new Response('intercepted', { status: 200 })
        : null,
    );

    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const intercepted = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://renderer/trpc/hello',
    } as any);
    expect(intercepted.status).toBe(200);
    expect(await intercepted.text()).toBe('intercepted');
    expect(resolveRendererFilePath).not.toHaveBeenCalled();

    const fallthrough = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://renderer/anything',
    } as any);
    expect(fallthrough.status).toBe(200);
    expect(await fallthrough.text()).toBe('static');
  });

  it('returns 404 for cross-host requests', async () => {
    const resolveRendererFilePath = vi.fn(async () => '/export/index.html');
    buildStaticManager(resolveRendererFilePath);
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://elsewhere/index.html',
    } as any);

    expect(response.status).toBe(404);
    expect(resolveRendererFilePath).not.toHaveBeenCalled();
  });
});

describe('ViteRendererFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    protocolHandlerRef.current = null;
    mockApp.isReady.mockReturnValue(true);
  });

  it('forwards GET requests to the Vite origin preserving pathname + search', async () => {
    mockFetch.mockResolvedValue(new Response('vite-served', { status: 200 }));

    const fallback = new ViteRendererFallback('http://localhost:5173');
    const manager = new RendererProtocolManager({ fallback });
    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers({ Accept: 'text/html' }),
      method: 'GET',
      url: 'app://renderer/src/main.tsx?t=12345',
    } as any);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [target, init] = mockFetch.mock.calls[0]!;
    expect(target).toBe('http://localhost:5173/src/main.tsx?t=12345');
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Accept')).toBe('text/html');
    expect(headers.get('Host')).toBeNull();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('vite-served');
  });

  it('forwards body and sets duplex for non-GET requests', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));

    const fallback = new ViteRendererFallback('http://localhost:5173/');
    const manager = new RendererProtocolManager({ fallback });
    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    await handler({
      headers: new Headers(),
      method: 'POST',
      body: 'payload' as any,
      url: 'app://renderer/__hmr',
    } as any);

    const [target, init] = mockFetch.mock.calls[0]!;
    expect(target).toBe('http://localhost:5173/__hmr');
    expect((init as RequestInit & { duplex?: string }).duplex).toBe('half');
    expect((init as any).body).toBe('payload');
  });

  it('returns 502 when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const fallback = new ViteRendererFallback('http://localhost:5173');
    const manager = new RendererProtocolManager({ fallback });
    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'app://renderer/@vite/client',
    } as any);

    expect(response.status).toBe(502);
  });
});
