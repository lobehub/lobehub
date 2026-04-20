import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileStore } from '@/store/file';

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
    it('should add files to knowledge base through the file store', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1', 'file-2', 'file-3'];
      const addResourcesToKnowledgeBase = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        addResourcesToKnowledgeBase,
      } as any);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addResourcesToKnowledgeBase).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(addResourcesToKnowledgeBase).toHaveBeenCalledTimes(1);
    });

    it('should handle single file addition', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1'];
      const addResourcesToKnowledgeBase = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        addResourcesToKnowledgeBase,
      } as any);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addResourcesToKnowledgeBase).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
    });

    it('should handle empty file array', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds: string[] = [];
      const addResourcesToKnowledgeBase = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        addResourcesToKnowledgeBase,
      } as any);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addResourcesToKnowledgeBase).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1', 'file-2'];
        const serviceError = new Error('Failed to add files to knowledge base');
        const addResourcesToKnowledgeBase = vi.fn().mockRejectedValue(serviceError);

        vi.spyOn(useFileStore, 'getState').mockReturnValue({
          addResourcesToKnowledgeBase,
        } as any);

        await expect(async () => {
          await act(async () => {
            await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to add files to knowledge base');
      });
    });
  });

  describe('removeFilesFromKnowledgeBase', () => {
    it('should remove files from knowledge base through the file store', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1', 'file-2', 'file-3'];
      const removeResourcesFromKnowledgeBase = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        removeResourcesFromKnowledgeBase,
      } as any);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeResourcesFromKnowledgeBase).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(removeResourcesFromKnowledgeBase).toHaveBeenCalledTimes(1);
    });

    it('should handle single file removal', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1'];
      const removeResourcesFromKnowledgeBase = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        removeResourcesFromKnowledgeBase,
      } as any);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeResourcesFromKnowledgeBase).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
    });

    it('should handle empty file array', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds: string[] = [];
      const removeResourcesFromKnowledgeBase = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        removeResourcesFromKnowledgeBase,
      } as any);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeResourcesFromKnowledgeBase).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1', 'file-2'];
        const serviceError = new Error('Failed to remove files from knowledge base');
        const removeResourcesFromKnowledgeBase = vi.fn().mockRejectedValue(serviceError);

        vi.spyOn(useFileStore, 'getState').mockReturnValue({
          removeResourcesFromKnowledgeBase,
        } as any);

        await expect(async () => {
          await act(async () => {
            await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to remove files from knowledge base');
      });
    });
  });
});
