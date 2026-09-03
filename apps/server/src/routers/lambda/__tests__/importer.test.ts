import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ImportResultData } from '@/types/importer';

import { importerRouter } from '../importer';

const mockGetFileContent = vi.fn();
const mockDeleteFile = vi.fn();
const mockImportData = vi.fn();
const mockImportPgData = vi.fn();
const mockAssertActiveOrLegacy = vi.fn();
const mockReleaseBestEffort = vi.fn();

vi.mock('@/database/repositories/dataImporter', () => ({
  DataImporterRepos: vi.fn().mockImplementation(() => ({
    importData: mockImportData,
    importPgData: mockImportPgData,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFileContent: mockGetFileContent,
    deleteFile: mockDeleteFile,
  })),
}));

vi.mock('@/server/services/fileUpload', () => ({
  FileUploadService: vi.fn().mockImplementation(() => ({
    assertActiveOrLegacy: mockAssertActiveOrLegacy,
    releaseBestEffort: mockReleaseBestEffort,
  })),
}));

describe('importerRouter', () => {
  const mockFileContent = JSON.stringify({
    version: 1,
    messages: [],
  });

  const mockPgData = {
    data: {},
    mode: 'pglite' as const,
    schemaHash: 'hash',
  };

  const mockImportResult: ImportResultData = {
    success: true,
    results: { messages: { added: 1, errors: 0, skips: 0 } },
  };

  const mockImportErrorResult: ImportResultData = {
    success: false,
    error: {
      message: 'Import failed',
      details: 'Error details',
    },
    results: {},
  };

  beforeEach(() => {
    mockAssertActiveOrLegacy.mockResolvedValue(undefined);
    mockGetFileContent.mockResolvedValue(mockFileContent);
    mockImportData.mockResolvedValue(mockImportResult);
    mockImportPgData.mockResolvedValue(mockImportResult);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const ctx = {
    userId: 'user-1',
    serverDB: {} as any,
  };

  describe('importByFile', () => {
    it('should successfully import file data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByFile({ pathname: 'test.json' });

      expect(result).toEqual(mockImportResult);
      expect(mockGetFileContent).toHaveBeenCalledWith('test.json');
      expect(mockImportData).toHaveBeenCalledWith(JSON.parse(mockFileContent));
      expect(mockDeleteFile).toHaveBeenCalledWith('test.json');
    });

    it('releases a reserved temporary upload after importing it', async () => {
      mockAssertActiveOrLegacy.mockResolvedValue({ id: 'upload-1', status: 'active' });
      const caller = importerRouter.createCaller(ctx);

      await caller.importByFile({ pathname: 'test.json' });

      expect(mockReleaseBestEffort).toHaveBeenCalledWith('test.json');
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('should handle PG data import', async () => {
      mockGetFileContent.mockResolvedValue(JSON.stringify(mockPgData));

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByFile({ pathname: 'test.json' });

      expect(result).toEqual(mockImportResult);
      expect(mockImportPgData).toHaveBeenCalledWith(mockPgData);
    });

    it('should throw error when file read fails', async () => {
      mockGetFileContent.mockRejectedValue(new Error('File read error'));

      const caller = importerRouter.createCaller(ctx);

      await expect(caller.importByFile({ pathname: 'test.json' })).rejects.toThrow(TRPCError);
    });

    it('should throw error for invalid JSON', async () => {
      mockGetFileContent.mockResolvedValue('invalid json');

      const caller = importerRouter.createCaller(ctx);

      await expect(caller.importByFile({ pathname: 'test.json' })).rejects.toThrow(TRPCError);
    });
  });

  describe('importByPost', () => {
    it('should successfully import posted data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const postData = {
        data: {
          version: 1,
          messages: [],
        },
      };

      const result = await caller.importByPost(postData);

      expect(result).toEqual(mockImportResult);
      expect(mockImportData).toHaveBeenCalledWith(postData.data);
    });

    it('should handle import failure', async () => {
      mockImportData.mockResolvedValue(mockImportErrorResult);

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByPost({
        data: {
          version: 1,
          messages: [],
        },
      });

      expect(result).toEqual(mockImportErrorResult);
    });
  });

  describe('importPgByPost', () => {
    it('should successfully import PG data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importPgByPost(mockPgData);

      expect(result).toEqual(mockImportResult);
      expect(mockImportPgData).toHaveBeenCalledWith(mockPgData);
    });

    it('should handle import failure', async () => {
      mockImportPgData.mockResolvedValue(mockImportErrorResult);

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importPgByPost(mockPgData);

      expect(result).toEqual(mockImportErrorResult);
    });
  });
});
