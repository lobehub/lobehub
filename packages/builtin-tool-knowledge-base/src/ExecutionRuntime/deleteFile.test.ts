import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeBaseExecutionRuntime } from './index';

const buildRuntime = (overrides: Partial<Parameters<typeof buildServices>[0]> = {}) => {
  const services = buildServices(overrides);
  return {
    runtime: new KnowledgeBaseExecutionRuntime(
      services.ragService,
      services.knowledgeBaseService,
      services.documentService,
      services.fileService,
    ),
    services,
  };
};

const buildServices = ({
  withFileService = true,
  fileExists = true,
  deleteThrows,
}: {
  withFileService?: boolean;
  fileExists?: boolean;
  deleteThrows?: Error;
} = {}) => ({
  ragService: {
    getFileContents: vi.fn(),
    semanticSearchForChat: vi.fn(),
  },
  knowledgeBaseService: undefined,
  documentService: undefined,
  fileService: withFileService
    ? {
        deleteFile: deleteThrows ? vi.fn().mockRejectedValue(deleteThrows) : vi.fn().mockResolvedValue(undefined),
        getFileItemById: vi
          .fn()
          .mockResolvedValue(
            fileExists
              ? {
                  createdAt: new Date('2026-01-01T00:00:00Z'),
                  fileType: 'image/png',
                  id: 'file_1',
                  metadata: null,
                  name: 'screenshot.png',
                  size: 123,
                  sourceType: 'file',
                  updatedAt: new Date('2026-01-02T00:00:00Z'),
                  url: 'https://r2.example/file_1.png',
                }
              : undefined,
          ),
        getKnowledgeItems: vi.fn(),
      }
    : undefined,
});

describe('KnowledgeBaseExecutionRuntime.deleteFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes an existing file and reports its name', async () => {
    const { runtime, services } = buildRuntime();

    const result = await runtime.deleteFile({ id: 'file_1' });

    expect(services.fileService!.deleteFile).toHaveBeenCalledWith('file_1');
    expect(result.success).toBe(true);
    expect(result.content).toContain('screenshot.png');
    expect(result.content).toContain('deleted permanently');
  });

  it('fails with not found when the file does not exist', async () => {
    const { runtime, services } = buildRuntime({ fileExists: false });

    const result = await runtime.deleteFile({ id: 'file_missing' });

    expect(services.fileService!.deleteFile).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.content).toContain('not found');
  });

  it('reports the deletion error when the service rejects', async () => {
    const { runtime } = buildRuntime({
      deleteThrows: new Error('storage unavailable'),
    });

    const result = await runtime.deleteFile({ id: 'file_1' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('storage unavailable');
  });

  it('fails cleanly when the file service is unavailable', async () => {
    const { runtime } = buildRuntime({ withFileService: false });

    const result = await runtime.deleteFile({ id: 'file_1' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('File service is not available');
  });
});
