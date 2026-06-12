import { afterEach, describe, expect, it, vi } from 'vitest';

const mockLocalSystem = vi.hoisted(() => ({
  getLocalFilePreviewUrl: vi.fn(),
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
    const { localFileService } = await import('./localFileService');

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
      type: 'text',
    });
  });

  it('throws when the preview URL cannot be created', async () => {
    const { localFileService } = await import('./localFileService');

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
    const { localFileService } = await import('./localFileService');

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
    const { localFileService } = await import('./localFileService');

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
});
