import { afterEach, describe, expect, it, vi } from 'vitest';

const mockDeviceClient = vi.hoisted(() => ({
  getLocalFilePreview: { query: vi.fn() },
  getProjectFileIndex: { query: vi.fn() },
}));

const mockLocalFileService = vi.hoisted(() => ({
  getLocalFilePreview: vi.fn(),
  getProjectFileIndex: vi.fn(),
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
});
