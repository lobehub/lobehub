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

const createKnowledgeResponse = (items: FileListItem[]) => ({
  hasMore: false,
  items,
});

describe('useResourceTreeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads root items for the library and lazily loads expanded folders', async () => {
    const getKnowledgeItemsSpy = vi.spyOn(fileService, 'getKnowledgeItems');

    getKnowledgeItemsSpy.mockImplementation(async ({ parentId }) => {
      if (parentId === null) {
        return createKnowledgeResponse([
          createKnowledgeItem('file-a', 'Alpha.md', null),
          createKnowledgeItem('folder-b', 'Bravo', null, 'custom/folder'),
          createKnowledgeItem('folder-a', 'Alpha', null, 'custom/folder'),
        ]);
      }

      return createKnowledgeResponse([
        createKnowledgeItem('file-child', 'Child.md', parentId ?? null),
      ]);
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
    vi.spyOn(fileService, 'getKnowledgeItems').mockImplementation(async ({ knowledgeBaseId }) =>
      createKnowledgeResponse([
        createKnowledgeItem(`${knowledgeBaseId}-folder`, 'Folder', null, 'custom/folder'),
      ]),
    );

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
    const libraryAResponse = createDeferred<ReturnType<typeof createKnowledgeResponse>>();

    vi.spyOn(fileService, 'getKnowledgeItems').mockImplementation(({ knowledgeBaseId }) => {
      if (knowledgeBaseId === 'library-a') return libraryAResponse.promise;

      return Promise.resolve(
        createKnowledgeResponse([createKnowledgeItem('library-b-file', 'Current.md', null)]),
      );
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
      libraryAResponse.resolve(
        createKnowledgeResponse([createKnowledgeItem('library-a-file', 'Stale.md', null)]),
      );
      await libraryAResponse.promise;
    });

    expect(result.current.childrenByParentId.get(null)?.map((node) => node.id)).toEqual([
      'library-b-file',
    ]);
  });

  it('ignores older same-parent responses when a newer revalidation finishes first', async () => {
    const staleRootResponse = createDeferred<ReturnType<typeof createKnowledgeResponse>>();
    const currentRootResponse = createDeferred<ReturnType<typeof createKnowledgeResponse>>();
    const getKnowledgeItemsSpy = vi.spyOn(fileService, 'getKnowledgeItems');

    getKnowledgeItemsSpy
      .mockResolvedValueOnce({
        hasMore: false,
        items: [createKnowledgeItem('initial-file', 'Initial.md', null)],
      })
      .mockReturnValueOnce(staleRootResponse.promise)
      .mockReturnValueOnce(currentRootResponse.promise);

    const { result } = renderHook(() => useResourceTreeController({ libraryId: 'library-a' }));

    await waitFor(() => {
      expect(result.current.childrenByParentId.get(null)?.map((node) => node.id)).toEqual([
        'initial-file',
      ]);
    });

    let staleLoad: Promise<void> | undefined;
    let currentRevalidation: Promise<void> | undefined;

    act(() => {
      staleLoad = result.current.loadChildren(null);
      currentRevalidation = result.current.revalidateParent(null);
    });

    expect(getKnowledgeItemsSpy).toHaveBeenCalledTimes(3);

    await act(async () => {
      currentRootResponse.resolve(
        createKnowledgeResponse([createKnowledgeItem('current-file', 'Current.md', null)]),
      );
      await currentRevalidation;
    });

    expect(result.current.childrenByParentId.get(null)?.map((node) => node.id)).toEqual([
      'current-file',
    ]);

    await act(async () => {
      staleRootResponse.resolve(
        createKnowledgeResponse([createKnowledgeItem('stale-file', 'Stale.md', null)]),
      );
      await staleLoad;
    });

    expect(result.current.childrenByParentId.get(null)?.map((node) => node.id)).toEqual([
      'current-file',
    ]);
  });

  it('does not issue duplicate folder loads during rapid repeated expansion', async () => {
    const folderResponse = createDeferred<ReturnType<typeof createKnowledgeResponse>>();
    const getKnowledgeItemsSpy = vi.spyOn(fileService, 'getKnowledgeItems');

    getKnowledgeItemsSpy.mockImplementation(({ parentId }) => {
      if (parentId === null) {
        return Promise.resolve(
          createKnowledgeResponse([
            createKnowledgeItem('folder-a', 'Folder A', null, 'custom/folder'),
          ]),
        );
      }

      return folderResponse.promise;
    });

    const { result } = renderHook(() => useResourceTreeController({ libraryId: 'library-a' }));

    await waitFor(() => {
      expect(result.current.childrenByParentId.get(null)?.map((node) => node.id)).toEqual([
        'folder-a',
      ]);
    });

    act(() => {
      result.current.setExpandedIds(['folder-a']);
      result.current.setExpandedIds(['folder-a']);
    });

    expect(
      getKnowledgeItemsSpy.mock.calls.filter(([params]) => params.parentId === 'folder-a'),
    ).toHaveLength(1);

    await act(async () => {
      folderResponse.resolve(
        createKnowledgeResponse([createKnowledgeItem('file-child', 'Child.md', 'folder-a')]),
      );
    });

    await waitFor(() => {
      expect(result.current.childrenByParentId.get('folder-a')?.map((node) => node.id)).toEqual([
        'file-child',
      ]);
    });
  });

  it('continues loading expanded ancestor folders as they become visible', async () => {
    const getKnowledgeItemsSpy = vi.spyOn(fileService, 'getKnowledgeItems');

    getKnowledgeItemsSpy.mockImplementation(async ({ parentId }) => {
      if (parentId === null) {
        return createKnowledgeResponse([
          createKnowledgeItem('folder-a', 'Folder A', null, 'custom/folder'),
        ]);
      }

      if (parentId === 'folder-a') {
        return createKnowledgeResponse([
          createKnowledgeItem('folder-b', 'Folder B', 'folder-a', 'custom/folder'),
        ]);
      }

      if (parentId === 'folder-b') {
        return createKnowledgeResponse([createKnowledgeItem('file-c', 'File C.md', 'folder-b')]);
      }

      return createKnowledgeResponse([]);
    });

    const { result } = renderHook(() => useResourceTreeController({ libraryId: 'library-a' }));

    act(() => {
      result.current.setExpandedIds(['folder-a', 'folder-b']);
    });

    await waitFor(() => {
      expect(result.current.childrenByParentId.get('folder-b')?.map((node) => node.id)).toEqual([
        'file-c',
      ]);
    });

    expect(getKnowledgeItemsSpy).toHaveBeenCalledWith({
      knowledgeBaseId: 'library-a',
      parentId: 'folder-a',
      showFilesInKnowledgeBase: false,
    });
    expect(getKnowledgeItemsSpy).toHaveBeenCalledWith({
      knowledgeBaseId: 'library-a',
      parentId: 'folder-b',
      showFilesInKnowledgeBase: false,
    });
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
