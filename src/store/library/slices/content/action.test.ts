import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import * as resourceHooks from '@/store/file/slices/resource/hooks';

import { useKnowledgeBaseStore as useStore } from '../../store';

vi.mock('zustand/traditional');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KnowledgeBaseContentActions', () => {
  describe('addFilesToKnowledgeBase', () => {
    it('should add files to knowledge base and refresh file list', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1', 'file-2', 'file-3'];

      const addFilesSpy = vi
        .spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase')
        .mockResolvedValue([
          {
            createdAt: new Date(),
            fileId: 'file-1',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
          {
            createdAt: new Date(),
            fileId: 'file-2',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
          {
            createdAt: new Date(),
            fileId: 'file-3',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
        ]);

      const revalidateResourcesSpy = vi
        .spyOn(resourceHooks, 'revalidateResources')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(addFilesSpy).toHaveBeenCalledTimes(1);
      expect(revalidateResourcesSpy).toHaveBeenCalled();
      expect(revalidateResourcesSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle single file addition', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1'];

      const addFilesSpy = vi
        .spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase')
        .mockResolvedValue([
          {
            createdAt: new Date(),
            fileId: 'file-1',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
        ]);

      const revalidateResourcesSpy = vi
        .spyOn(resourceHooks, 'revalidateResources')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(revalidateResourcesSpy).toHaveBeenCalled();
    });

    it('should handle empty file array', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds: string[] = [];

      const addFilesSpy = vi
        .spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase')
        .mockResolvedValue([]);

      const revalidateResourcesSpy = vi
        .spyOn(resourceHooks, 'revalidateResources')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(revalidateResourcesSpy).toHaveBeenCalled();
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1', 'file-2'];
        const serviceError = new Error('Failed to add files to knowledge base');

        vi.spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase').mockRejectedValue(serviceError);

        const revalidateResourcesSpy = vi
          .spyOn(resourceHooks, 'revalidateResources')
          .mockResolvedValue(undefined);

        await expect(async () => {
          await act(async () => {
            await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to add files to knowledge base');

        expect(revalidateResourcesSpy).not.toHaveBeenCalled();
      });

      it('should handle refresh file list errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1'];
        const refreshError = new Error('Failed to refresh file list');

        vi.spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase').mockResolvedValue([
          {
            createdAt: new Date(),
            fileId: 'file-1',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
        ]);

        vi.spyOn(resourceHooks, 'revalidateResources').mockRejectedValue(refreshError);

        await expect(async () => {
          await act(async () => {
            await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to refresh file list');
      });
    });
  });

  describe('removeFilesFromKnowledgeBase', () => {
    it('should remove files from knowledge base and refresh file list', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1', 'file-2', 'file-3'];

      const removeFilesSpy = vi
        .spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase')
        .mockResolvedValue({} as any);

      const revalidateResourcesSpy = vi
        .spyOn(resourceHooks, 'revalidateResources')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(removeFilesSpy).toHaveBeenCalledTimes(1);
      expect(revalidateResourcesSpy).toHaveBeenCalled();
      expect(revalidateResourcesSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle single file removal', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1'];

      const removeFilesSpy = vi
        .spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase')
        .mockResolvedValue({} as any);

      const revalidateResourcesSpy = vi
        .spyOn(resourceHooks, 'revalidateResources')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(revalidateResourcesSpy).toHaveBeenCalled();
    });

    it('should handle empty file array', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds: string[] = [];

      const removeFilesSpy = vi
        .spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase')
        .mockResolvedValue({} as any);

      const revalidateResourcesSpy = vi
        .spyOn(resourceHooks, 'revalidateResources')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(revalidateResourcesSpy).toHaveBeenCalled();
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1', 'file-2'];
        const serviceError = new Error('Failed to remove files from knowledge base');

        vi.spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase').mockRejectedValue(
          serviceError,
        );

        const revalidateResourcesSpy = vi
          .spyOn(resourceHooks, 'revalidateResources')
          .mockResolvedValue(undefined);

        await expect(async () => {
          await act(async () => {
            await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to remove files from knowledge base');

        expect(revalidateResourcesSpy).not.toHaveBeenCalled();
      });

      it('should handle refresh file list errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1'];
        const refreshError = new Error('Failed to refresh file list');

        vi.spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase').mockResolvedValue({} as any);

        vi.spyOn(resourceHooks, 'revalidateResources').mockRejectedValue(refreshError);

        await expect(async () => {
          await act(async () => {
            await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to refresh file list');
      });
    });
  });
});
