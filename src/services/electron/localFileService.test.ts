import { afterEach, describe, expect, it, vi } from 'vitest';

import { localFileService } from './localFileService';

const mockLocalSystem = vi.hoisted(() => ({
  getExternalAssetForPublishUrl: vi.fn(),
  getLocalFilePreviewUrl: vi.fn(),
  handleCopyFiles: vi.fn(),
  handleCreateDirectory: vi.fn(),
  handleCreateFile: vi.fn(),
  trashLocalFiles: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({
    localSystem: mockLocalSystem,
  }),
}));

describe('localFileService', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches text local-file preview from the preview URL', async () => {
    mockLocalSystem.getLocalFilePreviewUrl.mockResolvedValue({
      success: true,
      url: 'localfile://preview/index.html',
    });
    const fetchMock = vi.fn(async () => {
      return {
        blob: vi.fn(),
        headers: { get: vi.fn(() => 'text/html; charset=utf-8') },
        ok: true,
        text: vi.fn(async () => '<h1>Local</h1>'),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await localFileService.getLocalFilePreview({
      path: '/repo/index.html',
      workingDirectory: '/repo',
    });

    expect(mockLocalSystem.getLocalFilePreviewUrl).toHaveBeenCalledWith({
      path: '/repo/index.html',
      workingDirectory: '/repo',
    });
    expect(fetchMock).toHaveBeenCalledWith('localfile://preview/index.html');
    expect(preview).toEqual({
      content: '<h1>Local</h1>',
      contentType: 'text/html',
      resourceBaseUrl: undefined,
      type: 'text',
    });
  });

  it('returns the entry directory as the HTML workspace resource base URL', async () => {
    mockLocalSystem.getLocalFilePreviewUrl.mockResolvedValue({
      success: true,
      url: 'localfile://preview-session/pages/index.html',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            headers: { get: vi.fn(() => 'text/html; charset=utf-8') },
            ok: true,
            text: vi.fn(async () => '<link rel="stylesheet" href="../assets/app.css">'),
          }) as unknown as Response,
      ),
    );

    const preview = await localFileService.getLocalFilePreview({
      path: '/repo/pages/index.html',
      resourceScope: 'workspace',
      workingDirectory: '/repo',
    });

    expect(mockLocalSystem.getLocalFilePreviewUrl).toHaveBeenCalledWith({
      path: '/repo/pages/index.html',
      resourceScope: 'workspace',
      workingDirectory: '/repo',
    });
    expect(preview).toEqual({
      content: '<link rel="stylesheet" href="../assets/app.css">',
      contentType: 'text/html',
      resourceBaseUrl: 'localfile://preview-session/pages/',
      type: 'text',
    });
  });

  it('throws when the preview URL cannot be created', async () => {
    mockLocalSystem.getLocalFilePreviewUrl.mockResolvedValue({
      error: 'outside safe path',
      success: false,
    });

    await expect(
      localFileService.getLocalFilePreview({
        path: '/repo/index.html',
        workingDirectory: '/repo',
      }),
    ).rejects.toThrow('outside safe path');
  });

  it('forwards image-only preview constraints to Electron', async () => {
    mockLocalSystem.getLocalFilePreviewUrl.mockResolvedValue({
      success: true,
      url: 'localfile://preview/image.png',
    });
    const fetchMock = vi.fn(async () => {
      return {
        blob: vi.fn(async () => new Blob(['image'])),
        headers: { get: vi.fn(() => 'image/png') },
        ok: true,
        text: vi.fn(),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await localFileService.getLocalFilePreview({
      accept: 'image',
      path: '/repo/image.png',
      workingDirectory: '/repo',
    });

    expect(mockLocalSystem.getLocalFilePreviewUrl).toHaveBeenCalledWith({
      accept: 'image',
      path: '/repo/image.png',
      workingDirectory: '/repo',
    });
  });

  it('rejects non-image responses before reading the body for image-only previews', async () => {
    mockLocalSystem.getLocalFilePreviewUrl.mockResolvedValue({
      success: true,
      url: 'localfile://preview/.env',
    });
    const textMock = vi.fn(async () => 'SECRET=value');
    const fetchMock = vi.fn(async () => {
      return {
        blob: vi.fn(),
        headers: { get: vi.fn(() => 'text/plain; charset=utf-8') },
        ok: true,
        text: textMock,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      localFileService.getLocalFilePreview({
        accept: 'image',
        path: '/repo/.env',
        workingDirectory: '/repo',
      }),
    ).rejects.toThrow('Unsupported local file preview type');
    expect(textMock).not.toHaveBeenCalled();
  });

  it('reads local file bytes from the preview URL', async () => {
    mockLocalSystem.getLocalFilePreviewUrl.mockResolvedValue({
      success: true,
      url: 'localfile://preview/font.woff2',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            arrayBuffer: vi.fn(async () => new Uint8Array([10, 20, 30]).buffer),
            headers: { get: vi.fn(() => 'font/woff2') },
            ok: true,
          }) as unknown as Response,
      ),
    );

    const result = await localFileService.readLocalFileBytes({
      path: '/repo/font.woff2',
      workingDirectory: '/repo',
    });

    expect(result).toEqual({
      bytes: new Uint8Array([10, 20, 30]),
      contentType: 'font/woff2',
    });
  });

  it('uses the dedicated publish IPC channel for external bytes', async () => {
    mockLocalSystem.getExternalAssetForPublishUrl.mockResolvedValue({
      success: true,
      url: 'localfile://publish/font.woff2',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            arrayBuffer: vi.fn(async () => new Uint8Array([10, 20]).buffer),
            headers: { get: vi.fn(() => 'font/woff2') },
            ok: true,
          }) as unknown as Response,
      ),
    );

    await expect(
      localFileService.readExternalAssetForPublish({
        path: '/outside/font.woff2',
        workingDirectory: '/repo',
      }),
    ).resolves.toEqual({ bytes: new Uint8Array([10, 20]), contentType: 'font/woff2' });

    expect(mockLocalSystem.getExternalAssetForPublishUrl).toHaveBeenCalledWith({
      path: '/outside/font.woff2',
      workingDirectory: '/repo',
    });
    expect(mockLocalSystem.getLocalFilePreviewUrl).not.toHaveBeenCalled();
  });

  describe('file tree mutations', () => {
    it('routes create / mkdir / copy / trash to their localSystem IPC methods', async () => {
      mockLocalSystem.handleCreateFile.mockResolvedValue({ path: '/p/a.ts', success: true });
      mockLocalSystem.handleCreateDirectory.mockResolvedValue({ path: '/p/dir', success: true });
      mockLocalSystem.handleCopyFiles.mockResolvedValue([
        { sourcePath: '/p/a.ts', success: true, targetPath: '/p/a copy.ts' },
      ]);
      mockLocalSystem.trashLocalFiles.mockResolvedValue({
        items: [{ path: '/p/a.ts', success: true }],
        success: true,
      });

      await expect(localFileService.createLocalFile({ path: '/p/a.ts' })).resolves.toEqual({
        path: '/p/a.ts',
        success: true,
      });
      await expect(localFileService.createLocalDirectory({ path: '/p/dir' })).resolves.toEqual({
        path: '/p/dir',
        success: true,
      });
      await expect(
        localFileService.copyLocalFiles({ items: [{ sourcePath: '/p/a.ts' }] }),
      ).resolves.toEqual([{ sourcePath: '/p/a.ts', success: true, targetPath: '/p/a copy.ts' }]);
      await expect(localFileService.trashLocalFiles({ paths: ['/p/a.ts'] })).resolves.toEqual({
        items: [{ path: '/p/a.ts', success: true }],
        success: true,
      });

      expect(mockLocalSystem.handleCreateFile).toHaveBeenCalledWith({ path: '/p/a.ts' });
      expect(mockLocalSystem.handleCreateDirectory).toHaveBeenCalledWith({ path: '/p/dir' });
      expect(mockLocalSystem.handleCopyFiles).toHaveBeenCalledWith({
        items: [{ sourcePath: '/p/a.ts' }],
      });
      expect(mockLocalSystem.trashLocalFiles).toHaveBeenCalledWith({ paths: ['/p/a.ts'] });
    });
  });
});
