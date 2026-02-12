import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { uploadService } from '@/services/upload';
import { useUserStore } from '@/store/user';
import { ImportStage } from '@/types/importer';

import { importService } from './index';

// Mock dependencies
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    importer: {
      importByFile: {
        mutate: vi.fn(),
      },
      importByPost: {
        mutate: vi.fn(),
      },
      importPgByPost: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('@/services/upload', () => ({
  uploadService: {
    uploadDataToS3: vi.fn(),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: vi.fn(() => ({
      importAppSettings: vi.fn(),
    })),
  },
}));

vi.mock('@/utils/uuid', () => ({
  uuid: () => 'mock-uuid-123',
}));

describe('ImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('importSettings', () => {
    it('should import user settings successfully', async () => {
      const mockSettings = {
        language: 'en-US',
        themeMode: 'dark',
      };

      const importAppSettings = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useUserStore.getState).mockReturnValue({
        importAppSettings,
      } as any);

      await importService.importSettings(mockSettings as any);

      expect(importAppSettings).toHaveBeenCalledWith(mockSettings);
    });
  });

  describe('importData', () => {
    describe('small dataset (< 500 items)', () => {
      it('should import via POST when total items < 500', async () => {
        const mockData = {
          messages: Array.from({length: 100}).fill({ id: '1', content: 'test' }),
          sessionGroups: Array.from({length: 50}).fill({ id: '1', name: 'test' }),
          sessions: Array.from({length: 100}).fill({ id: '1', type: 'agent' }),
          topics: Array.from({length: 100}).fill({ id: '1', title: 'test' }),
          version: 1,
        };

        const mockResult = {
          results: {
            messages: { added: 100, errors: 0, skips: 0 },
            sessionGroups: { added: 50, errors: 0, skips: 0 },
            sessions: { added: 100, errors: 0, skips: 0 },
            topics: { added: 100, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(lambdaClient.importer.importByPost.mutate).mockResolvedValue(mockResult);

        const callbacks = {
          onStageChange: vi.fn(),
          onSuccess: vi.fn(),
          onError: vi.fn(),
        };

        await importService.importData(mockData as any, callbacks);

        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Importing);
        expect(lambdaClient.importer.importByPost.mutate).toHaveBeenCalledWith({ data: mockData });
        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Success);
        expect(callbacks.onSuccess).toHaveBeenCalledWith(mockResult.results, 0);
        expect(callbacks.onError).not.toHaveBeenCalled();
      });

      it('should handle error during small dataset import', async () => {
        const mockData = {
          messages: Array.from({length: 100}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        const mockError = {
          data: {
            code: 'IMPORT_ERROR',
            httpStatus: 400,
            path: '/api/import',
          },
          message: 'Import failed',
        };

        vi.mocked(lambdaClient.importer.importByPost.mutate).mockRejectedValue(mockError);

        const callbacks = {
          onStageChange: vi.fn(),
          onSuccess: vi.fn(),
          onError: vi.fn(),
        };

        await importService.importData(mockData as any, callbacks);

        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Importing);
        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Error);
        expect(callbacks.onError).toHaveBeenCalledWith({
          code: 'IMPORT_ERROR',
          httpStatus: 400,
          message: 'Import failed',
          path: '/api/import',
        });
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
      });

      it('should calculate duration correctly', async () => {
        const mockData = {
          messages: Array.from({length: 10}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        const mockResult = {
          results: {
            messages: { added: 10, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        let callCount = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => {
          callCount++;
          return callCount === 1 ? 1000000 : 1005000; // 5 second difference
        });

        vi.mocked(lambdaClient.importer.importByPost.mutate).mockResolvedValue(mockResult);

        const callbacks = {
          onSuccess: vi.fn(),
        };

        await importService.importData(mockData as any, callbacks);

        expect(callbacks.onSuccess).toHaveBeenCalledWith(mockResult.results, 5000);
      });
    });

    describe('large dataset (>= 500 items)', () => {
      it('should upload to S3 and import via file when total items >= 500', async () => {
        const mockData = {
          messages: Array.from({length: 500}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        const mockUploadResult = {
          success: true as const,
          data: {
            path: 'import_config/mock-uuid-123.json',
            filename: 'mock-uuid-123.json',
            dirname: 'import_config',
            date: '2024-01-01',
          },
        };

        const mockImportResult = {
          results: {
            messages: { added: 500, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(uploadService.uploadDataToS3).mockResolvedValue(mockUploadResult as any);
        vi.mocked(lambdaClient.importer.importByFile.mutate).mockResolvedValue(mockImportResult);

        const callbacks = {
          onStageChange: vi.fn(),
          onFileUploading: vi.fn(),
          onSuccess: vi.fn(),
          onError: vi.fn(),
        };

        await importService.importData(mockData as any, callbacks);

        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Uploading);
        expect(uploadService.uploadDataToS3).toHaveBeenCalledWith(
          mockData,
          expect.objectContaining({
            filename: 'mock-uuid-123.json',
            pathname: 'import_config/mock-uuid-123.json',
          }),
        );
        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Importing);
        expect(lambdaClient.importer.importByFile.mutate).toHaveBeenCalledWith({
          pathname: 'import_config/mock-uuid-123.json',
        });
        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Success);
        expect(callbacks.onSuccess).toHaveBeenCalled();
      });

      it('should handle upload error', async () => {
        const mockData = {
          messages: Array.from({length: 500}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        vi.mocked(uploadService.uploadDataToS3).mockRejectedValue(new Error('S3 upload failed'));

        const callbacks = {
          onStageChange: vi.fn(),
        };

        await expect(importService.importData(mockData as any, callbacks)).rejects.toThrow('Upload Error');

        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Uploading);
      });

      it('should handle import error after successful upload', async () => {
        const mockData = {
          messages: Array.from({length: 500}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        const mockUploadResult = {
          success: true as const,
          data: {
            path: 'import_config/mock-uuid-123.json',
            filename: 'mock-uuid-123.json',
            dirname: 'import_config',
            date: '2024-01-01',
          },
        };

        const mockError = {
          data: {
            code: 'FILE_IMPORT_ERROR',
            httpStatus: 500,
            path: '/api/import/file',
          },
          message: 'File import failed',
        };

        vi.mocked(uploadService.uploadDataToS3).mockResolvedValue(mockUploadResult as any);
        vi.mocked(lambdaClient.importer.importByFile.mutate).mockRejectedValue(mockError);

        const callbacks = {
          onStageChange: vi.fn(),
          onError: vi.fn(),
        };

        await importService.importData(mockData as any, callbacks);

        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Error);
        expect(callbacks.onError).toHaveBeenCalledWith({
          code: 'FILE_IMPORT_ERROR',
          httpStatus: 500,
          message: 'File import failed',
          path: '/api/import/file',
        });
      });

      it('should trigger file upload progress callback', async () => {
        const mockData = {
          messages: Array.from({length: 500}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        const mockUploadResult = {
          success: true as const,
          data: {
            path: 'import_config/mock-uuid-123.json',
            filename: 'mock-uuid-123.json',
            dirname: 'import_config',
            date: '2024-01-01',
          },
        };

        const mockImportResult = {
          results: {
            messages: { added: 500, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(uploadService.uploadDataToS3).mockImplementation(async (_data, options: any) => {
          // Simulate progress callback
          if (options.onProgress) {
            options.onProgress('uploading', {
              progress: 50,
              speed: 100,
              restTime: 5000,
            });
          }
          return mockUploadResult as any;
        });

        vi.mocked(lambdaClient.importer.importByFile.mutate).mockResolvedValue(mockImportResult);

        const callbacks = {
          onFileUploading: vi.fn(),
          onSuccess: vi.fn(),
        };

        await importService.importData(mockData as any, callbacks);

        expect(callbacks.onFileUploading).toHaveBeenCalledWith({
          progress: 50,
          speed: 100,
          restTime: 5000,
        });
      });
    });

    describe('edge cases', () => {
      it('should handle data with exactly 499 items via POST', async () => {
        const mockData = {
          messages: Array.from({length: 499}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        const mockResult = {
          results: {
            messages: { added: 499, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(lambdaClient.importer.importByPost.mutate).mockResolvedValue(mockResult);

        await importService.importData(mockData as any);

        expect(lambdaClient.importer.importByPost.mutate).toHaveBeenCalled();
        expect(uploadService.uploadDataToS3).not.toHaveBeenCalled();
      });

      it('should handle data with exactly 500 items via file upload', async () => {
        const mockData = {
          messages: Array.from({length: 500}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        const mockUploadResult = {
          success: true as const,
          data: {
            path: 'import_config/mock-uuid-123.json',
            filename: 'mock-uuid-123.json',
            dirname: 'import_config',
            date: '2024-01-01',
          },
        };

        const mockImportResult = {
          results: {
            messages: { added: 500, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(uploadService.uploadDataToS3).mockResolvedValue(mockUploadResult as any);
        vi.mocked(lambdaClient.importer.importByFile.mutate).mockResolvedValue(mockImportResult);

        await importService.importData(mockData as any);

        expect(uploadService.uploadDataToS3).toHaveBeenCalled();
        expect(lambdaClient.importer.importByPost.mutate).not.toHaveBeenCalled();
      });

      it('should handle empty data', async () => {
        const mockData = {
          version: 1,
        };

        const mockResult = {
          results: {},
          success: true as const,
        };

        vi.mocked(lambdaClient.importer.importByPost.mutate).mockResolvedValue(mockResult);

        await importService.importData(mockData as any);

        expect(lambdaClient.importer.importByPost.mutate).toHaveBeenCalledWith({ data: mockData });
      });

      it('should work without callbacks', async () => {
        const mockData = {
          messages: Array.from({length: 10}).fill({ id: '1', content: 'test' }),
          version: 1,
        };

        const mockResult = {
          results: {
            messages: { added: 10, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(lambdaClient.importer.importByPost.mutate).mockResolvedValue(mockResult);

        await expect(importService.importData(mockData as any)).resolves.not.toThrow();
      });
    });
  });

  describe('importPgData', () => {
    describe('small dataset (< 500 items)', () => {
      it('should import PostgreSQL data via POST when total items < 500', async () => {
        const mockData = {
          data: {
            users: Array.from({length: 100}).fill({ id: 1, name: 'test' }),
            sessions: Array.from({length: 200}).fill({ id: 1, name: 'test' }),
          },
          mode: 'postgres' as const,
          schemaHash: 'hash123',
        };

        const mockResult = {
          results: {
            users: { added: 100, errors: 0, skips: 0 },
            sessions: { added: 200, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(lambdaClient.importer.importPgByPost.mutate).mockResolvedValue(mockResult);

        const callbacks = {
          onStageChange: vi.fn(),
          onSuccess: vi.fn(),
        };

        await importService.importPgData(mockData as any, { callbacks });

        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Importing);
        expect(lambdaClient.importer.importPgByPost.mutate).toHaveBeenCalledWith(mockData);
        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Success);
        expect(callbacks.onSuccess).toHaveBeenCalledWith(mockResult.results, 0);
      });

      it('should handle error during PostgreSQL data import', async () => {
        const mockData = {
          data: {
            users: Array.from({length: 100}).fill({ id: 1, name: 'test' }),
          },
          mode: 'pglite' as const,
          schemaHash: 'hash123',
        };

        const mockError = {
          data: {
            code: 'PG_IMPORT_ERROR',
            httpStatus: 400,
            path: '/api/import/pg',
          },
          message: 'PostgreSQL import failed',
        };

        vi.mocked(lambdaClient.importer.importPgByPost.mutate).mockRejectedValue(mockError);

        const callbacks = {
          onStageChange: vi.fn(),
          onError: vi.fn(),
        };

        await importService.importPgData(mockData as any, { callbacks });

        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Error);
        expect(callbacks.onError).toHaveBeenCalledWith({
          code: 'PG_IMPORT_ERROR',
          httpStatus: 400,
          message: 'PostgreSQL import failed',
          path: '/api/import/pg',
        });
      });
    });

    describe('large dataset (>= 500 items)', () => {
      it('should upload to S3 and import via file when total items >= 500', async () => {
        const mockData = {
          data: {
            messages: Array.from({length: 500}).fill({ id: 1, content: 'test' }),
          },
          mode: 'postgres' as const,
          schemaHash: 'hash123',
        };

        const mockUploadResult = {
          success: true as const,
          data: {
            path: 'import_config/mock-uuid-123.json',
            filename: 'mock-uuid-123.json',
            dirname: 'import_config',
            date: '2024-01-01',
          },
        };

        const mockImportResult = {
          results: {
            messages: { added: 500, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(uploadService.uploadDataToS3).mockResolvedValue(mockUploadResult as any);
        vi.mocked(lambdaClient.importer.importByFile.mutate).mockResolvedValue(mockImportResult);

        const callbacks = {
          onStageChange: vi.fn(),
          onSuccess: vi.fn(),
        };

        await importService.importPgData(mockData as any, { callbacks });

        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Uploading);
        expect(uploadService.uploadDataToS3).toHaveBeenCalledWith(
          mockData,
          expect.objectContaining({
            filename: 'mock-uuid-123.json',
            pathname: 'import_config/mock-uuid-123.json',
          }),
        );
        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Importing);
        expect(callbacks.onStageChange).toHaveBeenCalledWith(ImportStage.Success);
      });

      it('should handle multiple tables with varying sizes', async () => {
        const mockData = {
          data: {
            users: Array.from({length: 100}).fill({ id: 1 }),
            messages: Array.from({length: 300}).fill({ id: 1 }),
            sessions: Array.from({length: 150}).fill({ id: 1 }),
          },
          mode: 'postgres' as const,
          schemaHash: 'hash123',
        };

        const mockUploadResult = {
          success: true as const,
          data: {
            path: 'import_config/mock-uuid-123.json',
            filename: 'mock-uuid-123.json',
            dirname: 'import_config',
            date: '2024-01-01',
          },
        };

        const mockImportResult = {
          results: {
            users: { added: 100, errors: 0, skips: 0 },
            messages: { added: 300, errors: 0, skips: 0 },
            sessions: { added: 150, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(uploadService.uploadDataToS3).mockResolvedValue(mockUploadResult as any);
        vi.mocked(lambdaClient.importer.importByFile.mutate).mockResolvedValue(mockImportResult);

        await importService.importPgData(mockData as any);

        expect(uploadService.uploadDataToS3).toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('should work without options', async () => {
        const mockData = {
          data: {
            users: Array.from({length: 10}).fill({ id: 1, name: 'test' }),
          },
          mode: 'pglite' as const,
          schemaHash: 'hash123',
        };

        const mockResult = {
          results: {
            users: { added: 10, errors: 0, skips: 0 },
          },
          success: true as const,
        };

        vi.mocked(lambdaClient.importer.importPgByPost.mutate).mockResolvedValue(mockResult);

        await expect(importService.importPgData(mockData as any)).resolves.not.toThrow();
      });

      it('should handle empty data object', async () => {
        const mockData = {
          data: {},
          mode: 'pglite' as const,
          schemaHash: 'hash123',
        };

        const mockResult = {
          results: {},
          success: true as const,
        };

        vi.mocked(lambdaClient.importer.importPgByPost.mutate).mockResolvedValue(mockResult);

        await importService.importPgData(mockData as any);

        expect(lambdaClient.importer.importPgByPost.mutate).toHaveBeenCalledWith(mockData);
      });

      it('should calculate total length correctly across multiple tables', async () => {
        const mockData = {
          data: {
            table1: Array.from({length: 100}).fill({}),
            table2: Array.from({length: 200}).fill({}),
            table3: Array.from({length: 199}).fill({}),
          },
          mode: 'postgres' as const,
          schemaHash: 'hash123',
        };

        const mockResult = {
          results: {},
          success: true as const,
        };

        vi.mocked(lambdaClient.importer.importPgByPost.mutate).mockResolvedValue(mockResult);

        await importService.importPgData(mockData as any);

        // Total is 499, should use POST
        expect(lambdaClient.importer.importPgByPost.mutate).toHaveBeenCalled();
        expect(uploadService.uploadDataToS3).not.toHaveBeenCalled();
      });
    });
  });
});
