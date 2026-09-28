import { afterEach, describe, expect, it, vi } from 'vitest';

import { localFileKeys } from '@/libs/swr/keys';

import { projectFileService, refreshProjectFiles } from './projectFile';

const mockDeviceClient = vi.hoisted(() => ({
  copyAssetForPublish: { mutate: vi.fn() },
  copyProjectFiles: { mutate: vi.fn() },
  createProjectDirectory: { mutate: vi.fn() },
  createProjectFile: { mutate: vi.fn() },
  moveProjectFiles: { mutate: vi.fn() },
  renameProjectFile: { mutate: vi.fn() },
  trashProjectFiles: { mutate: vi.fn() },
  getLocalFilePreview: { query: vi.fn() },
  getProjectFileIndex: { query: vi.fn() },
  readExternalAssetForPublish: { query: vi.fn() },
  searchProjectFiles: { query: vi.fn() },
}));

const mockLocalFileService = vi.hoisted(() => ({
  copyAssetForPublish: vi.fn(),
  copyLocalFiles: vi.fn(),
  createLocalDirectory: vi.fn(),
  createLocalFile: vi.fn(),
  moveLocalFiles: vi.fn(),
  renameLocalFile: vi.fn(),
  trashLocalFiles: vi.fn(),
  getLocalFilePreview: vi.fn(),
  getProjectFileIndex: vi.fn(),
  readExternalAssetForPublish: vi.fn(),
  searchProjectFiles: vi.fn(),
}));

const mockMutate = vi.hoisted(() => vi.fn());

vi.mock('@/libs/swr', () => ({
  mutate: mockMutate,
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

  describe('file tree mutations', () => {
    const REMOTE = { deviceId: 'device-1', workingDirectory: '/repo' };
    const LOCAL = { workingDirectory: '/repo' };

    it('creates a file through the device RPC or local IPC', async () => {
      mockDeviceClient.createProjectFile.mutate.mockResolvedValue({
        path: '/repo/a.ts',
        success: true,
      });
      mockLocalFileService.createLocalFile.mockResolvedValue({ path: '/repo/a.ts', success: true });

      await projectFileService.createProjectFile({ ...REMOTE, path: '/repo/a.ts' });
      await projectFileService.createProjectFile({ ...LOCAL, content: 'x', path: '/repo/a.ts' });

      expect(mockDeviceClient.createProjectFile.mutate).toHaveBeenCalledWith({
        content: undefined,
        deviceId: 'device-1',
        path: '/repo/a.ts',
        workingDirectory: '/repo',
      });
      expect(mockLocalFileService.createLocalFile).toHaveBeenCalledWith({
        content: 'x',
        path: '/repo/a.ts',
      });
    });

    it('creates a folder through the device RPC or local IPC', async () => {
      await projectFileService.createProjectDirectory({ ...REMOTE, path: '/repo/dir' });
      await projectFileService.createProjectDirectory({ ...LOCAL, path: '/repo/dir' });

      expect(mockDeviceClient.createProjectDirectory.mutate).toHaveBeenCalledWith({
        deviceId: 'device-1',
        path: '/repo/dir',
        workingDirectory: '/repo',
      });
      expect(mockLocalFileService.createLocalDirectory).toHaveBeenCalledWith({ path: '/repo/dir' });
    });

    it('copies through the device RPC or local IPC', async () => {
      const items = [{ sourcePath: '/repo/a.ts' }];

      await projectFileService.copyProjectFiles({ ...REMOTE, items });
      await projectFileService.copyProjectFiles({ ...LOCAL, items });

      expect(mockDeviceClient.copyProjectFiles.mutate).toHaveBeenCalledWith({
        deviceId: 'device-1',
        items,
        workingDirectory: '/repo',
      });
      expect(mockLocalFileService.copyLocalFiles).toHaveBeenCalledWith({ items });
    });

    it('trashes through the device RPC or local IPC', async () => {
      await projectFileService.trashProjectFiles({ ...REMOTE, paths: ['/repo/a.ts'] });
      await projectFileService.trashProjectFiles({ ...LOCAL, paths: ['/repo/a.ts'] });

      expect(mockDeviceClient.trashProjectFiles.mutate).toHaveBeenCalledWith({
        deviceId: 'device-1',
        paths: ['/repo/a.ts'],
        workingDirectory: '/repo',
      });
      expect(mockLocalFileService.trashLocalFiles).toHaveBeenCalledWith({ paths: ['/repo/a.ts'] });
    });

    it('surfaces a remote device without a trash as a rejection', async () => {
      mockDeviceClient.trashProjectFiles.mutate.mockRejectedValue(
        new Error('This device does not support moving files to the trash'),
      );

      await expect(
        projectFileService.trashProjectFiles({ ...REMOTE, paths: ['/repo/a.ts'] }),
      ).rejects.toThrow('This device does not support moving files to the trash');
    });

    it.each([
      ['local', LOCAL],
      ['remote', REMOTE],
    ])('refuses to trash, rename, move or duplicate the workspace root (%s)', async (_, target) => {
      await expect(
        projectFileService.trashProjectFiles({ ...target, paths: ['/repo/a.ts', '/repo/'] }),
      ).rejects.toThrow(/workspace root/);
      await expect(
        projectFileService.renameProjectFile({ ...target, newName: 'x', path: '/repo' }),
      ).rejects.toThrow(/workspace root/);
      await expect(
        projectFileService.moveProjectFiles({
          ...target,
          items: [{ newPath: '/repo/sub/repo', oldPath: '/repo' }],
        }),
      ).rejects.toThrow(/workspace root/);
      await expect(
        projectFileService.copyProjectFiles({ ...target, items: [{ sourcePath: '/repo' }] }),
      ).rejects.toThrow(/workspace root/);

      expect(mockLocalFileService.trashLocalFiles).not.toHaveBeenCalled();
      expect(mockLocalFileService.renameLocalFile).not.toHaveBeenCalled();
      expect(mockLocalFileService.moveLocalFiles).not.toHaveBeenCalled();
      expect(mockLocalFileService.copyLocalFiles).not.toHaveBeenCalled();
      expect(mockDeviceClient.trashProjectFiles.mutate).not.toHaveBeenCalled();
      expect(mockDeviceClient.renameProjectFile.mutate).not.toHaveBeenCalled();
      expect(mockDeviceClient.moveProjectFiles.mutate).not.toHaveBeenCalled();
      expect(mockDeviceClient.copyProjectFiles.mutate).not.toHaveBeenCalled();
    });

    it('refreshProjectFiles revalidates the file index and the git overlay', async () => {
      await refreshProjectFiles('device-1', '/repo');
      await refreshProjectFiles(undefined, '/repo');

      expect(mockMutate.mock.calls.map(([key]) => key)).toEqual([
        localFileKeys.projectIndex('device-1', '/repo'),
        localFileKeys.gitWorkingTreeFiles('device-1', '/repo'),
        localFileKeys.projectIndex(undefined, '/repo'),
        localFileKeys.gitWorkingTreeFiles(undefined, '/repo'),
      ]);
      expect(mockMutate.mock.calls[0][0]).toEqual(['localFile:projectIndex', 'device-1', '/repo']);
      expect(mockMutate.mock.calls[3][0]).toEqual([
        'localFile:gitWorkingTreeFiles',
        'local',
        '/repo',
      ]);
    });
  });
});
