import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalFileProtocolManager } from '../LocalFileProtocolManager';

const { mockApp, mockProtocol, mockReadFile, mockStat, protocolHandlerRef } = vi.hoisted(() => {
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
    mockStat: vi.fn(),
    protocolHandlerRef,
  };
});

vi.mock('electron', () => ({
  app: mockApp,
  protocol: mockProtocol,
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

describe('LocalFileProtocolManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    protocolHandlerRef.current = null;
    mockApp.isReady.mockReturnValue(true);
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

    expect(mockProtocol.handle).toHaveBeenCalledWith('localfile', expect.any(Function));
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'localfile://file/Users/alice/Pictures/cat.png',
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
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'localfile://file/Users/alice/project/App.tsx',
    });

    expect(mockStat).toHaveBeenCalledWith('/Users/alice/project/App.tsx');
    expect(mockReadFile).toHaveBeenCalledWith('/Users/alice/project/App.tsx');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  });

  it('decodes percent-encoded characters in the path', async () => {
    const manager = new LocalFileProtocolManager();
    manager.registerHandler();
    const handler = protocolHandlerRef.current;

    await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'localfile://file/Users/alice/My%20Pictures/%E5%9B%BE%20%23.png',
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
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'localfile://file/Users/alice/folder',
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
    const handler = protocolHandlerRef.current;

    const response = await handler({
      headers: new Headers(),
      method: 'GET',
      url: 'localfile://file/nonexistent.png',
    });

    expect(response.status).toBe(404);
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
