import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import type { FileService } from '@/server/services/file';
import type { MarketService } from '@/server/services/market';

import { SandboxMiddlewareService } from '../service';
import type { SandboxProvider } from '../types';

const findFilesToInitInSandbox = vi.fn();

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({ findFilesToInitInSandbox })),
}));

const createProvider = (): SandboxProvider =>
  ({
    capabilities: {
      backgroundCommands: true,
      exportFile: true,
      files: true,
      languages: ['python'],
      persistentSession: true,
      shell: true,
      skillScripts: true,
    },
    callTool: vi.fn(async () => ({ result: {}, success: true })),
    exportFileToUploadUrl: vi.fn(),
    kind: 'onlyboxes',
  }) satisfies SandboxProvider;

const createFileService = (): FileService =>
  ({
    createCachedPreSignedUrlForPreview: vi.fn(async () => 'https://download.example.com/x'),
  }) as unknown as FileService;

const baseOptions = () => ({
  fileService: createFileService(),
  marketService: {} as MarketService,
  serverDB: {} as LobeChatDatabase,
  topicId: 'topic-1',
  userId: 'user-1',
});

describe('SandboxMiddlewareService file initialization', () => {
  beforeEach(() => {
    findFilesToInitInSandbox.mockReset();
    findFilesToInitInSandbox.mockResolvedValue([
      { fileType: 'text/csv', id: 'f1', name: 'data.csv', size: 10, url: 'key-1' },
    ]);
  });

  it('syncs uploaded files into the sandbox before the first tool call', async () => {
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, baseOptions());

    await service.callTool('listFiles', { directoryPath: '/mnt/data' });

    expect(findFilesToInitInSandbox).toHaveBeenCalledWith('topic-1');
    expect(provider.callTool).toHaveBeenNthCalledWith(
      1,
      'runCommand',
      expect.objectContaining({ command: expect.stringContaining('curl') }),
    );
    expect(provider.callTool).toHaveBeenNthCalledWith(2, 'listFiles', {
      directoryPath: '/mnt/data',
    });
  });

  it('only runs the sync once per service instance', async () => {
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, baseOptions());

    await service.callTool('listFiles', {});
    await service.callTool('readFile', { path: '/mnt/data/data.csv' });

    const runCommandCalls = (provider.callTool as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([tool]) => tool === 'runCommand',
    );
    expect(runCommandCalls).toHaveLength(1);
  });

  it('skips the sync when there is no serverDB', async () => {
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, {
      ...baseOptions(),
      serverDB: undefined,
    });

    await service.callTool('listFiles', {});

    expect(findFilesToInitInSandbox).not.toHaveBeenCalled();
    expect(provider.callTool).toHaveBeenCalledTimes(1);
    expect(provider.callTool).toHaveBeenCalledWith('listFiles', {});
  });

  it('does not sync when there are no uploaded files', async () => {
    findFilesToInitInSandbox.mockResolvedValue([]);
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, baseOptions());

    await service.callTool('listFiles', {});

    expect(provider.callTool).toHaveBeenCalledTimes(1);
    expect(provider.callTool).toHaveBeenCalledWith('listFiles', {});
  });

  it('enforces the server-resolved timeout at the provider boundary', async () => {
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, {
      ...baseOptions(),
      executionTimeoutMs: 90_000,
      serverDB: undefined,
    });

    await service.callTool('runCommand', { command: 'sleep 900', timeout: 900_000 });

    expect(provider.callTool).toHaveBeenCalledWith('runCommand', {
      command: 'sleep 900',
      timeout: 90_000,
    });
  });

  it('preserves a caller timeout shorter than the server-resolved budget', async () => {
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, {
      ...baseOptions(),
      executionTimeoutMs: 90_000,
      serverDB: undefined,
    });

    await service.callTool('runCommand', { command: 'sleep 5', timeout: 5000 });

    expect(provider.callTool).toHaveBeenCalledWith('runCommand', {
      command: 'sleep 5',
      timeout: 5000,
    });
  });

  it('does not add command timeout fields to non-command tools', async () => {
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, {
      ...baseOptions(),
      executionTimeoutMs: 90_000,
      serverDB: undefined,
    });

    await service.callTool('readFile', { path: '/mnt/data/report.txt' });

    expect(provider.callTool).toHaveBeenCalledWith('readFile', {
      path: '/mnt/data/report.txt',
    });
  });

  it('never blocks the tool call when the sync fails', async () => {
    findFilesToInitInSandbox.mockRejectedValue(new Error('db down'));
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, baseOptions());

    await expect(service.callTool('listFiles', {})).resolves.toMatchObject({ success: true });
    expect(provider.callTool).toHaveBeenCalledWith('listFiles', {});
  });

  it('skips files exceeding the size cap, matching what the prompt advertises', async () => {
    findFilesToInitInSandbox.mockResolvedValue([
      {
        fileType: 'application/zip',
        id: 'big',
        name: 'huge.zip',
        size: 200 * 1024 * 1024,
        url: 'k',
      },
    ]);
    const provider = createProvider();
    const service = new SandboxMiddlewareService(provider, baseOptions());

    await service.callTool('listFiles', {});

    // oversized file is filtered out → nothing to download → only the real tool runs
    expect(provider.callTool).toHaveBeenCalledTimes(1);
    expect(provider.callTool).toHaveBeenCalledWith('listFiles', {});
  });
});
