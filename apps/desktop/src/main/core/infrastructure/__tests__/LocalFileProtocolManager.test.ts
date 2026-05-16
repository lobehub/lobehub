import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalFileProtocolManager } from '../LocalFileProtocolManager';

const { mockApp, mockProtocol, mockReadFile, mockRealpath, mockStat, protocolHandlerRef } =
  vi.hoisted(() => {
    const protocolHandlerRef = { current: null as any };

    return {
      mockApp: {
        isReady: vi.fn().mockReturnValue(true),
        whenReady: vi.fn().mockResolvedValue(undefined),
      },
      mockProtocol: {
        handle: vi.fn((_scheme: string, handler: any) => {
          protocolHandlerRef.current = handler;
        }),
      },
      mockReadFile: vi.fn(),
      mockRealpath: vi.fn(),
      mockStat: vi.fn(),
      protocolHandlerRef,
    };
  });

vi.mock('electron', () => ({
  app: mockApp,
  protocol: mockProtocol,
}));

vi.mock('node:fs/promises', () => ({
  realpath: mockRealpath,
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

describe('LocalFileProtocolManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    protocolHandlerRef.current = null;
    mockApp.isReady.mockReturnValue(true);
    mockRealpath.mockImplementation(async (filePath: string) => filePath);
    mockStat.mockImplementation(async () => ({ isFile: () => true, size: 1024 }));
    mockReadFile.mockImplementation(async () => Buffer.from('image-bytes'));
  });

  afterEach(() => {
    protocolHandlerRef.current = null;
  });

  it('exposes scheme metadata for registerSchemesAsPrivileged', () => {
    const manager = new LocalFileProtocolManager();
    expect(manager.protocolScheme).toEqual({
      privileges: expect.objectContaining({
        bypassCSP: false,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      }),
      scheme: 'localfile',
    });
  });

  it('serves a POSIX absolute path with the correct mime type', async () => {
    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    await manager.approveWorkspaceRoot('/Users/alice');
    const url = await manager.createPreviewUrl({
      filePath: '/Users/alice/Pictures/cat.png',
      workspaceRoot: '/Users/alice',
    });
    if (!url) throw new Error('Expected local file preview URL');

    expect(mockProtocol.handle).toHaveBeenCalledWith('localfile', expect.any(Function));
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url,
    });

    expect(mockStat).toHaveBeenCalledWith('/Users/alice/Pictures/cat.png');
    expect(mockReadFile).toHaveBeenCalledWith('/Users/alice/Pictures/cat.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Length')).toBe('11'); // 'image-bytes'.length
  });

  it('serves source files as text through the localfile protocol', async () => {
    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    await manager.approveWorkspaceRoot('/Users/alice/project');
    const url = await manager.createPreviewUrl({
      filePath: '/Users/alice/project/App.tsx',
      workspaceRoot: '/Users/alice/project',
    });
    if (!url) throw new Error('Expected local file preview URL');
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url,
    });

    expect(mockStat).toHaveBeenCalledWith('/Users/alice/project/App.tsx');
    expect(mockReadFile).toHaveBeenCalledWith('/Users/alice/project/App.tsx');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  });

  it('decodes percent-encoded characters in the path', async () => {
    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    await manager.approveWorkspaceRoot('/Users/alice');
    const url = await manager.createPreviewUrl({
      filePath: '/Users/alice/My Pictures/图 #.png',
      workspaceRoot: '/Users/alice',
    });
    if (!url) throw new Error('Expected local file preview URL');
    const handler = protocolHandlerRef.current;

    await handler({
      headers: new Headers(),
      method: 'GET',
      url,
    });

    expect(mockStat).toHaveBeenCalledWith('/Users/alice/My Pictures/图 #.png');
  });

  it('rejects requests to a different host', async () => {
    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'localfile://other/Users/alice/cat.png',
    });

    expect(response.status).toBe(404);
    expect(mockStat).not.toHaveBeenCalled();
  });

  it('returns 404 when the path is a directory', async () => {
    mockStat.mockImplementation(async () => ({ isFile: () => false, size: 0 }));

    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    await manager.approveWorkspaceRoot('/Users/alice');
    const url = await manager.createPreviewUrl({
      filePath: '/Users/alice/folder',
      workspaceRoot: '/Users/alice',
    });
    if (!url) throw new Error('Expected local file preview URL');
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url,
    });

    expect(response.status).toBe(404);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('maps ENOENT errors to a 404 response', async () => {
    mockStat.mockImplementation(async () => {
      const err: NodeJS.ErrnoException = new Error('no such file');
      err.code = 'ENOENT';
      throw err;
    });

    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    await manager.approveWorkspaceRoot('/');
    const handler = protocolHandlerRef.current;
    const url = await manager.createPreviewUrl({
      filePath: '/nonexistent.png',
      workspaceRoot: '/',
    });
    if (!url) throw new Error('Expected local file preview URL');

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url,
    });

    expect(response.status).toBe(404);
  });

  it('rejects direct localfile requests without a main-issued preview token', async () => {
    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'localfile://file/Users/alice/.ssh/id_rsa',
    });

    expect(response.status).toBe(403);
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('rejects forged preview tokens before resolving the requested path', async () => {
    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'localfile://file/Users/alice/.ssh/id_rsa?token=forged',
    });

    expect(response.status).toBe(403);
    expect(mockRealpath).not.toHaveBeenCalled();
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('does not mint preview URLs outside an approved workspace root', async () => {
    const manager = new LocalFileProtocolManager();
    await manager.approveWorkspaceRoot('/Users/alice/project');

    const url = await manager.createPreviewUrl({
      filePath: '/Users/alice/.ssh/id_rsa',
      workspaceRoot: '/Users/alice/project',
    });

    expect(url).toBeNull();
  });

  it('can approve a project root derived from an already approved nested scope', async () => {
    const manager = new LocalFileProtocolManager();
    await manager.approveWorkspaceRoot('/Users/alice/project/packages/app');
    await manager.approveProjectRootFromScope({
      projectRoot: '/Users/alice/project',
      requestedScope: '/Users/alice/project/packages/app',
    });

    const url = await manager.createPreviewUrl({
      filePath: '/Users/alice/project/root.ts',
      workspaceRoot: '/Users/alice/project',
    });
    if (!url) throw new Error('Expected local file preview URL');

    expect(url).toContain('token=');
  });

  it('can mint preview URLs for roots produced by the main-process project index', async () => {
    const manager = new LocalFileProtocolManager();
    await manager.approveIndexedProjectRoot('/Users/alice/project');

    const url = await manager.createPreviewUrl({
      filePath: '/Users/alice/project/App.tsx',
      workspaceRoot: '/Users/alice/project',
    });
    if (!url) throw new Error('Expected local file preview URL');

    expect(url).toContain('token=');
  });

  it('defers registration until app ready when not yet ready', async () => {
    mockApp.isReady.mockReturnValue(false);
    let resolveReady: () => void = () => undefined;
    mockApp.whenReady.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    );

    const manager = new LocalFileProtocolManager();
    manager.registerHandler();

    expect(mockProtocol.handle).not.toHaveBeenCalled();
    resolveReady();
    await new Promise((r) => setImmediate(r));
    expect(mockProtocol.handle).toHaveBeenCalled();
  });
});
