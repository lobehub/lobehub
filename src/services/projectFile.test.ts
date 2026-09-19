import { afterEach, describe, expect, it, vi } from 'vitest';

const mockDeviceClient = vi.hoisted(() => ({
  copyAssetForPublish: { mutate: vi.fn() },
  getLocalFilePreview: { query: vi.fn() },
  getProjectFileIndex: { query: vi.fn() },
  readExternalAssetForPublish: { query: vi.fn() },
  searchProjectFiles: { query: vi.fn() },
}));

const mockLocalFileService = vi.hoisted(() => ({
  copyAssetForPublish: vi.fn(),
  getLocalFilePreview: vi.fn(),
  getProjectFileIndex: vi.fn(),
  readExternalAssetForPublish: vi.fn(),
  searchProjectFiles: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isDesktop: true,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    device: mockDeviceClient,
  },
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: mockLocalFileService,
}));

describe('projectFileService', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('gets remote local-file preview through device RPC', async () => {
    const { projectFileService } = await import('./projectFile');

    mockDeviceClient.getLocalFilePreview.query.mockResolvedValue({
      preview: {
        content: '<h1>Remote</h1>',
        contentType: 'text/html',
        type: 'text',
      },
      success: true,
    });

    const preview = await projectFileService.getLocalFilePreview({
      deviceId: 'device-1',
      path: '/repo/index.html',
      workingDirectory: '/repo',
    });

    expect(mockDeviceClient.getLocalFilePreview.query).toHaveBeenCalledWith({
      accept: undefined,
      deviceId: 'device-1',
      path: '/repo/index.html',
      workingDirectory: '/repo',
    });
    expect(mockLocalFileService.getLocalFilePreview).not.toHaveBeenCalled();
    expect(preview).toEqual({
      content: '<h1>Remote</h1>',
      contentType: 'text/html',
      type: 'text',
    });
  });

  it('forwards image-only preview constraints to remote device RPC', async () => {
    const { projectFileService } = await import('./projectFile');

    mockDeviceClient.getLocalFilePreview.query.mockResolvedValue({
      preview: {
        base64: 'aW1hZ2U=',
        contentType: 'image/png',
        type: 'image',
      },
      success: true,
    });

    await projectFileService.getLocalFilePreview({
      accept: 'image',
      deviceId: 'device-1',
      path: '/repo/image.png',
      workingDirectory: '/repo',
    });

    expect(mockDeviceClient.getLocalFilePreview.query).toHaveBeenCalledWith({
      accept: 'image',
      deviceId: 'device-1',
      path: '/repo/image.png',
      workingDirectory: '/repo',
    });
    expect(mockLocalFileService.getLocalFilePreview).not.toHaveBeenCalled();
  });

  it('rejects non-image remote payloads for image-only previews', async () => {
    const { projectFileService } = await import('./projectFile');

    mockDeviceClient.getLocalFilePreview.query.mockResolvedValue({
      preview: {
        content: 'SECRET=value',
        contentType: 'text/plain',
        type: 'text',
      },
      success: true,
    });

    await expect(
      projectFileService.getLocalFilePreview({
        accept: 'image',
        deviceId: 'device-1',
        path: '/repo/.env',
        workingDirectory: '/repo',
      }),
    ).rejects.toThrow('Unsupported local file preview type');
  });

  it('delegates desktop local-file preview to localFileService', async () => {
    const { projectFileService } = await import('./projectFile');

    mockLocalFileService.getLocalFilePreview.mockResolvedValue({
      content: '<h1>Local</h1>',
      contentType: 'text/html',
      type: 'text',
    });

    const preview = await projectFileService.getLocalFilePreview({
      path: '/repo/index.html',
      workingDirectory: '/repo',
    });

    expect(mockLocalFileService.getLocalFilePreview).toHaveBeenCalledWith({
      path: '/repo/index.html',
      workingDirectory: '/repo',
    });
    expect(mockDeviceClient.getLocalFilePreview.query).not.toHaveBeenCalled();
    expect(preview).toEqual({
      content: '<h1>Local</h1>',
      contentType: 'text/html',
      type: 'text',
    });
  });

  it('reads an external publish asset through the dedicated remote RPC', async () => {
    const { projectFileService } = await import('./projectFile');
    mockDeviceClient.readExternalAssetForPublish.query.mockResolvedValue({
      base64: 'AQID',
      contentType: 'image/png',
      success: true,
    });

    await expect(
      projectFileService.readExternalAssetForPublish({
        deviceId: 'device-1',
        path: '/outside/image.png',
        workingDirectory: '/repo',
      }),
    ).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });

    expect(mockDeviceClient.readExternalAssetForPublish.query).toHaveBeenCalledWith({
      deviceId: 'device-1',
      path: '/outside/image.png',
      workingDirectory: '/repo',
    });
    expect(mockDeviceClient.getLocalFilePreview.query).not.toHaveBeenCalled();
  });

  it('reads an external publish asset through the dedicated desktop service', async () => {
    const { projectFileService } = await import('./projectFile');
    const result = { bytes: new Uint8Array([4]), contentType: 'font/woff2' };
    mockLocalFileService.readExternalAssetForPublish.mockResolvedValue(result);

    await expect(
      projectFileService.readExternalAssetForPublish({
        path: '/outside/font.woff2',
        workingDirectory: '/repo',
      }),
    ).resolves.toBe(result);

    expect(mockLocalFileService.readExternalAssetForPublish).toHaveBeenCalledWith({
      path: '/outside/font.woff2',
      workingDirectory: '/repo',
    });
    expect(mockLocalFileService.getLocalFilePreview).not.toHaveBeenCalled();
  });

  it('copies a publish asset through the remote RPC or the desktop service', async () => {
    const { projectFileService } = await import('./projectFile');
    const params = {
      from: '/outside/logo.png',
      to: '/repo/.lobe-artifacts/site/logo.png',
      workingDirectory: '/repo',
    };
    mockDeviceClient.copyAssetForPublish.mutate.mockResolvedValue({ success: true });
    mockLocalFileService.copyAssetForPublish.mockResolvedValue({ success: true });

    await expect(
      projectFileService.copyAssetForPublish({ deviceId: 'device-1', ...params }),
    ).resolves.toEqual({ success: true });
    expect(mockDeviceClient.copyAssetForPublish.mutate).toHaveBeenCalledWith({
      deviceId: 'device-1',
      ...params,
    });

    await expect(projectFileService.copyAssetForPublish(params)).resolves.toEqual({
      success: true,
    });
    expect(mockLocalFileService.copyAssetForPublish).toHaveBeenCalledWith(params);
  });

  it('searches remote project files through device RPC', async () => {
    const { projectFileService } = await import('./projectFile');
    mockDeviceClient.searchProjectFiles.query.mockResolvedValue({
      entries: [],
      root: '/repo',
      searchedAt: '2026-07-01T00:00:00.000Z',
      source: 'git',
    });

    await projectFileService.searchProjectFiles({
      deviceId: 'device-1',
      limit: 20,
      query: 'button',
      scope: '/repo',
    });

    expect(mockDeviceClient.searchProjectFiles.query).toHaveBeenCalledWith({
      deviceId: 'device-1',
      excludeIgnored: undefined,
      changedOnly: undefined,
      limit: 20,
      query: 'button',
      scope: '/repo',
    });
    expect(mockLocalFileService.searchProjectFiles).not.toHaveBeenCalled();
  });

  it('searches local project files through localFileService', async () => {
    const { projectFileService } = await import('./projectFile');
    mockLocalFileService.searchProjectFiles.mockResolvedValue({
      entries: [],
      root: '/repo',
      searchedAt: '2026-07-01T00:00:00.000Z',
      source: 'git',
    });

    await projectFileService.searchProjectFiles({
      limit: 20,
      query: 'button',
      scope: '/repo',
    });

    expect(mockLocalFileService.searchProjectFiles).toHaveBeenCalledWith({
      excludeIgnored: undefined,
      changedOnly: undefined,
      limit: 20,
      query: 'button',
      scope: '/repo',
    });
    expect(mockDeviceClient.searchProjectFiles.query).not.toHaveBeenCalled();
  });
});
