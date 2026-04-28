import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file';
import type { FileListItem } from '@/types/files';

import { useResourceTreeController } from './useResourceTreeController';

const { mockRefreshFileList } = vi.hoisted(() => ({
  mockRefreshFileList: vi.fn(),
}));

vi.mock('@/store/file', () => ({
  useFileStore: {
    getState: () => ({
      refreshFileList: mockRefreshFileList,
    }),
  },
}));

const createKnowledgeItem = (
  id: string,
  name: string,
  parentId: string | null,
  fileType = 'text/markdown',
): FileListItem => ({
  chunkCount: null,
  chunkingError: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  embeddingError: null,
  fileType,
  finishEmbedding: true,
  id,
  name,
  parentId,
  size: 1,
  sourceType: 'file',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  url: `/resources/${id}`,
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('useResourceTreeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads root items for the library and lazily loads expanded folders', async () => {
    const getKnowledgeItemsSpy = vi.spyOn(fileService, 'getKnowledgeItems');

    getKnowledgeItemsSpy.mockImplementation(async ({ parentId }) => {
      if (parentId === null) {
        return {
          items: [
            createKnowledgeItem('file-a', 'Alpha.md', null),
            createKnowledgeItem('folder-b', 'Bravo', null, 'custom/folder'),
            createKnowledgeItem('folder-a', 'Alpha', null, 'custom/folder'),
          ],
        };
      }

      return {
        items: [createKnowledgeItem('file-child', 'Child.md', parentId ?? null)],
      };
    });

    const { result } = renderHook(() => useResourceTreeController({ libraryId: 'library-a' }));

    await waitFor(() => {
      expect(result.current.statusByParentId.get(null)).toBe('idle');
    });

    expect(getKnowledgeItemsSpy).toHaveBeenCalledWith({
      knowledgeBaseId: 'library-a',
      parentId: null,
      showFilesInKnowledgeBase: false,
    });
    expect(result.current.childrenByParentId.get(null)?.map((node) => node.id)).toEqual([
      'folder-a',
      'folder-b',
      'file-a',
    ]);
    expect(result.current.nodes.map((node) => node.id)).toEqual(['folder-a', 'folder-b', 'file-a']);

    act(() => {
      result.current.setExpandedIds(['folder-a']);
    });

    await waitFor(() => {
      expect(result.current.childrenByParentId.get('folder-a')?.map((node) => node.id)).toEqual([
        'file-child',
      ]);
    });

    expect(getKnowledgeItemsSpy).toHaveBeenCalledWith({
      knowledgeBaseId: 'library-a',
      parentId: 'folder-a',
      showFilesInKnowledgeBase: false,
    });
    expect(result.current.nodes[0].children?.map((node) => node.id)).toEqual(['file-child']);
  });

  it('clears local tree state on library switch', async () => {
    vi.spyOn(fileService, 'getKnowledgeItems').mockImplementation(async ({ knowledgeBaseId }) => ({
      items: [createKnowledgeItem(`${knowledgeBaseId}-folder`, 'Folder', null, 'custom/folder')],
    }));

    const { rerender, result } = renderHook(
      ({ libraryId }) => useResourceTreeController({ libraryId }),
      { initialProps: { libraryId: 'library-a' } },
    );

    await waitFor(() => {
      expect(result.current.childrenByParentId.get(null)?.[0]?.id).toBe('library-a-folder');
    });

    act(() => {
      result.current.setExpandedIds(['library-a-folder']);
      result.current.setSelectedTreeIds(['library-a-folder']);
    });

    rerender({ libraryId: 'library-b' });

    expect(result.current.childrenByParentId.get(null)).toBeUndefined();
    expect(result.current.expandedIds).toEqual([]);
    expect(result.current.selectedTreeIds).toEqual([]);

    await waitFor(() => {
      expect(result.current.childrenByParentId.get(null)?.[0]?.id).toBe('library-b-folder');
    });
  });

  it('ignores stale responses from a previous library generation', async () => {
    const libraryAResponse = createDeferred<{ items: FileListItem[] }>();

    vi.spyOn(fileService, 'getKnowledgeItems').mockImplementation(({ knowledgeBaseId }) => {
      if (knowledgeBaseId === 'library-a') return libraryAResponse.promise;

      return Promise.resolve({
        items: [createKnowledgeItem('library-b-file', 'Current.md', null)],
      });
    });

    const { rerender, result } = renderHook(
      ({ libraryId }) => useResourceTreeController({ libraryId }),
      { initialProps: { libraryId: 'library-a' } },
    );

    await waitFor(() => {
      expect(fileService.getKnowledgeItems).toHaveBeenCalledWith({
        knowledgeBaseId: 'library-a',
        parentId: null,
        showFilesInKnowledgeBase: false,
      });
    });

    rerender({ libraryId: 'library-b' });

    await waitFor(() => {
      expect(result.current.childrenByParentId.get(null)?.map((node) => node.id)).toEqual([
        'library-b-file',
      ]);
    });

    await act(async () => {
      libraryAResponse.resolve({
        items: [createKnowledgeItem('library-a-file', 'Stale.md', null)],
      });
      await libraryAResponse.promise;
    });

    expect(result.current.childrenByParentId.get(null)?.map((node) => node.id)).toEqual([
      'library-b-file',
    ]);
  });

  it('keeps selected tree ids as local state that changes independently', () => {
    const { result } = renderHook(() => useResourceTreeController({ libraryId: null }));

    act(() => {
      result.current.setSelectedTreeIds(['node-a', 'node-b']);
    });

    expect(result.current.selectedTreeIds).toEqual(['node-a', 'node-b']);
    expect(result.current.expandedIds).toEqual([]);
    expect(result.current.childrenByParentId.size).toBe(0);
  });
});
