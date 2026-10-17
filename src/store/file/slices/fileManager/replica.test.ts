/**
 * @vitest-environment happy-dom
 *
 * The file manager's knowledge-item list and by-id detail are
 * `@lobechat/replica` resources: the persisted head page / detail paints before
 * the network answers, the response confirms and persists it, "load more"
 * appends through the engine, and — because the two resources are linked — a
 * rename or delete reaches the list row and every loaded detail entry at once.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { lambdaClient } from '@/libs/trpc/client';
import { type FileListItem } from '@/types/files';

import { useFileStore } from '../../store';
import {
  fileDetailResource,
  type FileListData,
  type FileListParams,
  fileListResource,
} from './projection';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    document: { updateDocument: { mutate: vi.fn() } },
    file: {
      getFileItemById: { query: vi.fn() },
      getKnowledgeItems: { query: vi.fn() },
      publishFileToWorkspace: { mutate: vi.fn() },
      removeFile: { mutate: vi.fn() },
      removeFiles: { mutate: vi.fn() },
      setFileVisibility: { mutate: vi.fn() },
      updateFile: { mutate: vi.fn() },
    },
  },
}));

const BASE_PARAMS: FileListParams = { category: 'all', pageSize: 50 };
const BASE_KEY = fileListResource.storageKey(BASE_PARAMS);

const file = (id: string, name = id): FileListItem =>
  ({
    chunkCount: null,
    chunkingError: null,
    createdAt: new Date(0),
    embeddingError: null,
    fileType: 'text/plain',
    finishEmbedding: false,
    id,
    name,
    size: 1,
    sourceType: 'file',
    updatedAt: new Date(0),
    url: `https://example.com/${id}`,
  }) as FileListItem;

const listData = (items: FileListItem[], total?: number): FileListData => ({
  currentPage: 0,
  hasMore: total === undefined ? false : total > items.length,
  items,
  pageSize: BASE_PARAMS.pageSize,
  total,
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

describe('fileManager replicas', () => {
  const scopes = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`file-user-${randomUUID()}:personal`);
    act(() =>
      useFileStore.setState({
        dockUploadFileList: [],
        fileDetailMap: {},
        fileList: [],
        fileListMeta: undefined,
      }),
    );
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) => [
        fileListResource.storage!.remove({ queryKey: BASE_KEY, scope: value }),
        fileDetailResource.storage!.remove({ queryKey: 'file-1', scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted head page before the network answers', async () => {
    await fileListResource.storage!.set(
      { queryKey: BASE_KEY, scope },
      { data: listData([file('cached-1')], 40), updatedAt: 1 },
    );
    vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockImplementation(pending);

    const sync = renderHook(
      () => useFileStore((s) => s.useFetchKnowledgeItems)({ category: 'all', limit: 50 }),
      { wrapper },
    );

    await waitFor(() =>
      expect(useFileStore.getState().fileList.map((f) => f.id)).toEqual(['cached-1']),
    );
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the head page with the server response and persists it', async () => {
    vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockResolvedValue({
      hasMore: true,
      items: [file('a'), file('b')],
    } as any);

    renderHook(
      () => useFileStore((s) => s.useFetchKnowledgeItems)({ category: 'all', limit: 50 }),
      { wrapper },
    );

    await waitFor(() =>
      expect(useFileStore.getState().fileList.map((f) => f.id)).toEqual(['a', 'b']),
    );
    expect(useFileStore.getState().fileListMeta?.hasMore).toBe(true);
    // A non-final page leaves the total unknown; the response still persists.
    await waitFor(async () => {
      const row = await fileListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect((row?.data as FileListData).items.map((f) => f.id)).toEqual(['a', 'b']);
    });
  });

  it('appends the next page with the loaded query params', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => file(`file-${i}`));
    const secondPage = Array.from({ length: 5 }, (_, i) => file(`file-${50 + i}`));
    vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockImplementation(
      async (params: any) =>
        ((params?.offset ?? 0) === 0
          ? { hasMore: true, items: firstPage }
          : { hasMore: false, items: secondPage }) as any,
    );

    renderHook(
      () => useFileStore((s) => s.useFetchKnowledgeItems)({ category: 'all', limit: 50 }),
      { wrapper },
    );
    await waitFor(() => expect(useFileStore.getState().fileList).toHaveLength(50));

    await act(async () => {
      await useFileStore.getState().loadMoreKnowledgeItems();
    });

    const list = useFileStore.getState().fileList;
    expect(list).toHaveLength(55);
    expect(list[50].id).toBe('file-50');
    expect(lambdaClient.file.getKnowledgeItems.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 50, offset: 50 }),
    );
  });

  it('keeps the loaded tail when the head revalidates', async () => {
    // 55 rows on the server: a full head page (`hasMore`) plus a 5-row terminal page.
    const head = Array.from({ length: 50 }, (_, i) => file(`file-${i}`));
    const tail = Array.from({ length: 5 }, (_, i) => file(`file-${50 + i}`));
    vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockImplementation(
      async (params: any) =>
        ((params?.offset ?? 0) === 0
          ? { hasMore: true, items: head }
          : { hasMore: false, items: tail }) as any,
    );

    renderHook(
      () => useFileStore((s) => s.useFetchKnowledgeItems)({ category: 'all', limit: 50 }),
      { wrapper },
    );
    await waitFor(() => expect(useFileStore.getState().fileList).toHaveLength(50));
    await act(async () => {
      await useFileStore.getState().loadMoreKnowledgeItems();
    });
    expect(useFileStore.getState().fileList).toHaveLength(55);
    expect(useFileStore.getState().fileListMeta?.hasMore).toBe(false);

    // A refresh re-fetches only the head page, which reports `hasMore` and no
    // total. The rows the user already loaded must survive it.
    await act(async () => {
      await useFileStore.getState().refreshFileList({ revalidateResources: false });
    });

    expect(useFileStore.getState().fileList.map((f) => f.id)).toEqual(
      [...head, ...tail].map((f) => f.id),
    );
    expect(useFileStore.getState().fileListMeta?.hasMore).toBe(false);
  });

  it('keeps paging open when a revalidated head still has rows beyond the loaded depth', async () => {
    // 150 rows on the server: two full pages (`hasMore`) plus a terminal page.
    const page = (start: number) => Array.from({ length: 50 }, (_, i) => file(`a-${start + i}`));
    vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockImplementation(async (params: any) => {
      const offset = params?.offset ?? 0;
      if (offset === 0) return { hasMore: true, items: page(0) } as any;
      if (offset === 50) return { hasMore: true, items: page(50) } as any;
      return { hasMore: false, items: page(100) } as any;
    });

    renderHook(
      () => useFileStore((s) => s.useFetchKnowledgeItems)({ category: 'all', limit: 50 }),
      { wrapper },
    );
    await waitFor(() => expect(useFileStore.getState().fileList).toHaveLength(50));
    await act(async () => {
      await useFileStore.getState().loadMoreKnowledgeItems();
    });
    expect(useFileStore.getState().fileList).toHaveLength(100);
    expect(useFileStore.getState().fileListMeta?.hasMore).toBe(true);

    // The head page says nothing about rows 101+, so the refresh must neither
    // drop the loaded depth nor close paging.
    await act(async () => {
      await useFileStore.getState().refreshFileList({ revalidateResources: false });
    });
    expect(useFileStore.getState().fileList).toHaveLength(100);
    expect(useFileStore.getState().fileListMeta?.hasMore).toBe(true);

    await act(async () => {
      await useFileStore.getState().loadMoreKnowledgeItems();
    });
    expect(useFileStore.getState().fileList).toHaveLength(150);
    expect(useFileStore.getState().fileList[149].id).toBe('a-149');
    expect(useFileStore.getState().fileListMeta?.hasMore).toBe(false);
  });

  it('reaches exhaustion when a filtered page is shorter than the window', async () => {
    // The endpoint pages raw rows and drops Inbox folders afterwards, so a page
    // can be shorter than `pageSize` while raw rows remain — and the last page
    // can be shorter still. Both pages here carry fewer rows than the window.
    const visible = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => file(`v-${start + i}`));
    vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockImplementation(
      async (params: any) =>
        ((params?.offset ?? 0) === 0
          ? { hasMore: true, items: visible(0, 40) }
          : { hasMore: false, items: visible(40, 5) }) as any,
    );

    renderHook(
      () => useFileStore((s) => s.useFetchKnowledgeItems)({ category: 'all', limit: 50 }),
      { wrapper },
    );
    await waitFor(() => expect(useFileStore.getState().fileList).toHaveLength(40));
    expect(useFileStore.getState().fileListMeta?.hasMore).toBe(true);

    await act(async () => {
      await useFileStore.getState().loadMoreKnowledgeItems();
    });
    expect(useFileStore.getState().fileList).toHaveLength(45);
    expect(useFileStore.getState().fileListMeta?.hasMore).toBe(false);

    // The server ended the list, so another attempt must not issue a request.
    const calls = vi.mocked(lambdaClient.file.getKnowledgeItems.query).mock.calls.length;
    await act(async () => {
      await useFileStore.getState().loadMoreKnowledgeItems();
    });
    expect(vi.mocked(lambdaClient.file.getKnowledgeItems.query).mock.calls.length).toBe(calls);
  });

  // The explorer deletes through the resource slice, not through this one. Both
  // of this slice's replicas persist by id, so a confirmed deletion must evict
  // them too — otherwise a later direct visit repaints the deleted item until a
  // NOT_FOUND answer arrives, and offline that answer never comes.
  describe('resource deletion eviction', () => {
    it('drops the list row and the persisted detail when the explorer deletes a resource', async () => {
      vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockResolvedValue({
        hasMore: false,
        items: [file('file-1', 'Original'), file('file-2')],
      } as any);
      vi.mocked(lambdaClient.file.getFileItemById.query).mockResolvedValue(
        file('file-1', 'Original'),
      );
      vi.mocked(lambdaClient.file.removeFile.mutate).mockResolvedValue(undefined);

      renderHook(
        () => {
          useFileStore((s) => s.useFetchKnowledgeItems)({ category: 'all', limit: 50 });
          useFileStore((s) => s.useFetchKnowledgeItem)('file-1');
        },
        { wrapper },
      );
      await waitFor(() => {
        expect(useFileStore.getState().fileDetailMap['file-1']?.file?.name).toBe('Original');
      });

      await act(async () => {
        await useFileStore.getState().deleteResource('file-1');
      });

      expect(useFileStore.getState().fileList.map((f) => f.id)).toEqual(['file-2']);
      expect(useFileStore.getState().fileDetailMap['file-1']).toBeUndefined();
      // The persisted row is gone, so a reload cannot repaint the deleted item.
      await expect(
        fileDetailResource.storage!.get({ queryKey: 'file-1', scope }),
      ).resolves.toBeFalsy();
    });
  });

  describe('confirmed missing detail', () => {
    it('drops the persisted projection on NOT_FOUND so a reload cannot paint the stale file', async () => {
      // A previous visit persisted this file's detail.
      await fileDetailResource.storage!.set(
        { queryKey: 'file-1', scope },
        { data: { file: file('file-1', 'Stale') }, updatedAt: 1 },
      );
      // The server now answers NOT_FOUND (deleted or inaccessible).
      vi.mocked(lambdaClient.file.getFileItemById.query).mockRejectedValue(
        Object.assign(new Error('File not found'), { data: { code: 'NOT_FOUND' } }),
      );

      const { result } = renderHook(() => useFileStore((s) => s.useFetchKnowledgeItem)('file-1'), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.data).toBeUndefined();
        expect(result.current.isLoading).toBe(false);
      });
      // The view carries the confirmed absence…
      expect(useFileStore.getState().fileDetailMap['file-1']).toEqual({ file: null });
      // …and the stale persisted projection is gone: a reload hydrates nothing.
      await waitFor(async () => {
        expect(
          await fileDetailResource.storage!.get({ queryKey: 'file-1', scope }),
        ).toBeUndefined();
      });
    });
  });

  describe('linked entity mutations', () => {
    const seed = async () => {
      vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockResolvedValue({
        hasMore: false,
        items: [file('file-1', 'Original'), file('file-2')],
      } as any);
      vi.mocked(lambdaClient.file.getFileItemById.query).mockResolvedValue(
        file('file-1', 'Original'),
      );

      renderHook(
        () => {
          useFileStore((s) => s.useFetchKnowledgeItems)({ category: 'all', limit: 50 });
          useFileStore((s) => s.useFetchKnowledgeItem)('file-1');
        },
        { wrapper },
      );

      await waitFor(() => {
        expect(useFileStore.getState().fileList).toHaveLength(2);
        expect(useFileStore.getState().fileDetailMap['file-1']?.file?.name).toBe('Original');
      });
    };

    const listName = () => useFileStore.getState().fileList.find((f) => f.id === 'file-1')?.name;
    const detailName = () => useFileStore.getState().fileDetailMap['file-1']?.file?.name;

    it('renames the list row and the loaded detail optimistically', async () => {
      await seed();
      let resolveUpdate!: (value: unknown) => void;
      vi.mocked(lambdaClient.document.updateDocument.mutate).mockImplementation(
        () => new Promise((resolve) => (resolveUpdate = resolve)) as any,
      );

      let operation!: Promise<unknown>;
      act(() => {
        operation = useFileStore.getState().renameFolder('file-1', 'Renamed');
      });

      expect(listName()).toBe('Renamed');
      expect(detailName()).toBe('Renamed');

      vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockResolvedValue({
        hasMore: false,
        items: [file('file-1', 'Renamed'), file('file-2')],
      } as any);
      await act(async () => {
        resolveUpdate({});
        await operation;
      });

      expect(listName()).toBe('Renamed');
    });

    it('rolls both copies back when the rename fails', async () => {
      await seed();
      vi.mocked(lambdaClient.document.updateDocument.mutate).mockRejectedValue(new Error('boom'));

      const operation = useFileStore.getState().renameFolder('file-1', 'Renamed');
      await act(async () => {
        await expect(operation).rejects.toThrow('boom');
      });

      expect(listName()).toBe('Original');
      expect(detailName()).toBe('Original');
    });

    it('drops a removed file from the list and its detail', async () => {
      await seed();
      vi.mocked(lambdaClient.file.removeFile.mutate).mockResolvedValue(undefined);
      vi.mocked(lambdaClient.file.getKnowledgeItems.query).mockResolvedValue({
        hasMore: false,
        items: [file('file-2')],
      } as any);

      await act(async () => {
        await useFileStore.getState().removeFileItem('file-1');
      });

      expect(useFileStore.getState().fileList.map((f) => f.id)).toEqual(['file-2']);
      expect(useFileStore.getState().fileDetailMap['file-1']).toBeUndefined();
    });
  });
});
