import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { uploadService } from '@/services/upload';
import type { ImportPgDataStructure } from '@/types/export';
import type { ImporterEntryData, OnImportCallbacks } from '@/types/importer';
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
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(['legacy', 'postgres'] as const)('%s import failures', (format) => {
    const runImport = (count: number, callbacks?: OnImportCallbacks) => {
      const messages = Array.from({ length: count }, () => ({ id: '1', content: 'test' }));
      return format === 'legacy'
        ? importService.importData({ messages, version: 1 } as ImporterEntryData, callbacks)
        : importService.importPgData(
            {
              data: { messages },
              mode: 'postgres',
              schemaHash: 'hash123',
            } as ImportPgDataStructure,
            { callbacks },
          );
    };

    it.each([1, 500])('reports server failure for %i records', async (count) => {
      const response = {
        error: { message: 'Transaction failed' },
        results: {},
        success: false as const,
      };
      vi.mocked(lambdaClient.importer.importByPost.mutate).mockResolvedValue(response);
      vi.mocked(lambdaClient.importer.importPgByPost.mutate).mockResolvedValue(response);
      vi.mocked(lambdaClient.importer.importByFile.mutate).mockResolvedValue(response);
      vi.mocked(uploadService.uploadDataToS3).mockResolvedValue({
        data: { path: 'import_config/test.json' },
      } as Awaited<ReturnType<typeof uploadService.uploadDataToS3>>);
      const callbacks = { onError: vi.fn(), onStageChange: vi.fn(), onSuccess: vi.fn() };

      await runImport(count, callbacks);

      expect(callbacks.onStageChange.mock.calls.flat()).toEqual(
        count < 500
          ? [ImportStage.Importing, ImportStage.Error]
          : [ImportStage.Uploading, ImportStage.Importing, ImportStage.Error],
      );
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith({
        code: 'INTERNAL_SERVER_ERROR',
        httpStatus: 500,
        message: 'Transaction failed',
        path: undefined,
      });
      expect(callbacks.onSuccess).not.toHaveBeenCalled();
      await expect(runImport(count)).resolves.toBeUndefined();
    });
  });
});
