/**
 * @vitest-environment happy-dom
 *
 * `file/slices/document` is a by-id replica of the `documents` table: one entry
 * per document id, persisted per identity scope, so the resource manager paints
 * the open page from the projection and the network only confirms it. This suite
 * drives the real sync path (SWR provider + the app's scoped mutate) instead of
 * poking the store.
 */
import { randomUUID } from 'node:crypto';

import {
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  DERIVED_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { documentService } from '@/services/document';
import { DocumentSourceType, type LobeDocument } from '@/types/document';
import { type ResourceItem } from '@/types/resource';

import { useFileStore } from '../../store';
import { getResourceQueryKey } from '../resource/utils';
import { initialDocumentState } from './initialState';
import { fileDocumentResource } from './projection';

const mocks = vi.hoisted(() => ({ activeWorkspaceId: null as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => mocks.activeWorkspaceId,
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/services/document', () => ({
  documentService: {
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    getDocumentById: vi.fn(),
    updateDocument: vi.fn(),
  },
}));

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

/** A `documents` row as the server returns it. */
const serverRow = (overrides: Record<string, unknown> = {}) =>
  ({
    content: 'Body',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    editorData: '{}',
    fileType: CUSTOM_DOCUMENT_FILE_TYPE,
    filename: 'Old title',
    id: 'doc-1',
    metadata: {},
    parentId: null,
    slug: null,
    source: 'document',
    sourceType: DocumentSourceType.EDITOR,
    title: 'Old title',
    totalCharCount: 4,
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }) as any;

/** The normalized store shape the replica holds. */
const lobeDocument = (overrides: Partial<LobeDocument> = {}): LobeDocument => ({
  content: 'Body',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  editorData: {},
  fileType: CUSTOM_DOCUMENT_FILE_TYPE,
  filename: 'Old title',
  id: 'doc-1',
  metadata: {},
  source: 'document',
  sourceType: DocumentSourceType.EDITOR,
  title: 'Old title',
  totalCharCount: 4,
  totalLineCount: 0,
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  ...overrides,
});

const createResourceFixture = (overrides: Partial<ResourceItem> = {}): ResourceItem => ({
  content: 'Body',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  editorData: {},
  fileType: CUSTOM_DOCUMENT_FILE_TYPE,
  id: 'doc-1',
  knowledgeBaseId: 'kb-1',
  metadata: {},
  name: 'Old title',
  parentId: null,
  size: 4,
  sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
  title: 'Old title',
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  url: 'document',
  ...overrides,
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = <T>() => new Promise<T>(() => {});

const storedRow = (documentId: string, scope: string) =>
  fileDocumentResource.storage!.get({ queryKey: documentId, scope });

describe('file document replica', () => {
  const scopes = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  /** Render `useFetchDocumentDetail` the way the resource manager calls it. */
  const renderDetail = (documentId: string | undefined) =>
    renderHook(
      () => {
        const useFetchDocumentDetail = useFileStore((s) => s.useFetchDocumentDetail);

        return useFetchDocumentDetail(documentId);
      },
      { wrapper },
    );

  beforeEach(() => {
    mocks.activeWorkspaceId = null;
    useScope(`file-user-${randomUUID()}:personal`);
    act(() =>
      useFileStore.setState(
        {
          ...initialDocumentState,
          queryParams: undefined,
          resourceList: [],
          resourceMap: new Map(),
        },
        false,
      ),
    );
    vi.mocked(documentService.createDocument).mockReset();
    vi.mocked(documentService.deleteDocument).mockReset();
    vi.mocked(documentService.getDocumentById).mockReset();
    vi.mocked(documentService.updateDocument).mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].map((value) =>
        Promise.all(
          ['doc-1', 'doc-2', 'folder-1'].map((id) =>
            fileDocumentResource.storage!.remove({ queryKey: id, scope: value }),
          ),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('by-id detail', () => {
    it('paints the persisted row on the first frame, before the network answers', async () => {
      const cached = lobeDocument({ content: '# Cached', title: 'Cached' });
      await fileDocumentResource.storage!.set(
        { queryKey: 'doc-1', scope },
        { data: { document: cached }, updatedAt: 1 },
      );
      vi.mocked(documentService.getDocumentById).mockImplementation(() => pending());

      const { result } = renderDetail('doc-1');

      await waitFor(() =>
        expect(useFileStore.getState().documentMap['doc-1']).toEqual({ document: cached }),
      );
      expect(result.current.data).toEqual(cached);
      expect(result.current.isLoading).toBe(false);
      // The network request is still in flight; the frame did not wait for it.
      expect(result.current.isValidating).toBe(true);
    });

    it('adopts the server row and persists the projection', async () => {
      vi.mocked(documentService.getDocumentById).mockResolvedValue(
        serverRow({ content: '# Server', title: 'Server title' }) as any,
      );

      const { result } = renderDetail('doc-1');

      await waitFor(() =>
        expect(useFileStore.getState().documentMap['doc-1']?.document?.content).toBe('# Server'),
      );
      expect(result.current.data?.title).toBe('Server title');
      await waitFor(async () => {
        const stored = await storedRow('doc-1', scope);
        expect(stored?.data.document?.content).toBe('# Server');
      });
    });

    it('resolves a missing document to not found and never persists the marker', async () => {
      vi.mocked(documentService.getDocumentById).mockResolvedValue(undefined as any);

      const { result } = renderDetail('doc-1');

      await waitFor(() =>
        expect(useFileStore.getState().documentMap['doc-1']).toEqual({ document: null }),
      );
      expect(result.current.data).toBeNull();
      expect(await storedRow('doc-1', scope)).toBeUndefined();
    });

    it('drops the previous identity’s rows before the next one paints', async () => {
      vi.mocked(documentService.getDocumentById).mockResolvedValue(serverRow() as any);

      const sync = renderDetail('doc-1');
      await waitFor(() => expect(useFileStore.getState().documentMap['doc-1']).toBeDefined());

      vi.mocked(documentService.getDocumentById).mockImplementation(() => pending());
      useScope(`file-user-${randomUUID()}:personal`);
      sync.rerender();

      await waitFor(() => expect(useFileStore.getState().documentMap['doc-1']).toBeUndefined());
    });

    it('warms the replica for a prefetch so the next visit paints from storage', async () => {
      const prefetched = serverRow({ id: 'doc-2', content: '# Prefetched', title: 'Prefetched' });
      vi.mocked(documentService.getDocumentById).mockResolvedValue(prefetched as any);

      const { result } = renderHook(() => useFileStore(), { wrapper });

      await act(async () => {
        await result.current.prefetchDocument('doc-2');
      });

      expect(useFileStore.getState().documentMap['doc-2']?.document?.content).toBe('# Prefetched');
      await waitFor(async () => {
        const stored = await storedRow('doc-2', scope);
        expect(stored?.data.document?.content).toBe('# Prefetched');
      });
    });
  });

  describe('writes', () => {
    it('keeps the created folder in the replica and in the current resource list', async () => {
      vi.mocked(documentService.createDocument).mockResolvedValue(
        serverRow({
          content: '',
          fileType: CUSTOM_FOLDER_FILE_TYPE,
          id: 'folder-1',
          parentId: null,
          slug: 'new-folder',
          title: 'New Folder',
          totalCharCount: 0,
        }) as any,
      );

      const { result } = renderHook(() => useFileStore(), { wrapper });

      act(() => {
        useFileStore.setState({ queryParams: { libraryId: 'kb-1', parentId: null } }, false);
      });

      await act(async () => {
        await result.current.createFolder('New Folder', undefined, 'kb-1');
      });

      expect(useFileStore.getState().resourceList.map((item) => item.id)).toEqual(['folder-1']);
      expect(useFileStore.getState().resourceMap.get('folder-1')).toMatchObject({
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        id: 'folder-1',
        knowledgeBaseId: 'kb-1',
        name: 'New Folder',
        parentId: null,
        slug: 'new-folder',
        sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
        title: 'New Folder',
      });
      // The new row is openable without another round trip.
      expect(useFileStore.getState().documentMap['folder-1']?.document).toMatchObject({
        id: 'folder-1',
        title: 'New Folder',
      });
    });

    it('puts a created page into the replica so it resolves by id immediately', async () => {
      vi.mocked(documentService.createDocument).mockResolvedValue(
        serverRow({ content: 'Hello', id: 'doc-2', title: 'Fresh page' }) as any,
      );

      const { result } = renderHook(() => useFileStore(), { wrapper });

      await act(async () => {
        await result.current.createDocument({ content: 'Hello', title: 'Fresh page' });
      });

      expect(useFileStore.getState().documentMap['doc-2']?.document).toMatchObject({
        content: 'Hello',
        id: 'doc-2',
        title: 'Fresh page',
      });
    });

    it('updates the replica and the visible resource after a successful save', async () => {
      const existingResource = createResourceFixture();
      vi.mocked(documentService.updateDocument).mockResolvedValue({
        historyAppended: false,
        id: 'doc-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as any);

      const { result } = renderHook(() => useFileStore(), { wrapper });

      act(() => {
        useFileStore.setState(
          {
            documentMap: { 'doc-1': { document: lobeDocument() } },
            queryParams: { libraryId: 'kb-1', parentId: null },
            resourceList: [existingResource],
            resourceMap: new Map([[existingResource.id, existingResource]]),
          },
          false,
        );
      });

      await act(async () => {
        await result.current.updateDocument('doc-1', {
          metadata: { emoji: 'page' },
          title: 'Renamed title',
        });
      });

      expect(documentService.updateDocument).toHaveBeenCalledWith({
        content: undefined,
        editorData: undefined,
        id: 'doc-1',
        metadata: { emoji: 'page' },
        parentId: undefined,
        title: 'Renamed title',
      });
      expect(useFileStore.getState().documentMap['doc-1']?.document).toMatchObject({
        metadata: { emoji: 'page' },
        title: 'Renamed title',
      });
      expect(useFileStore.getState().resourceMap.get('doc-1')).toMatchObject({
        metadata: { emoji: 'page' },
        name: 'Renamed title',
        title: 'Renamed title',
      });
    });

    it('shows a rename optimistically and clears the resource marker after sync', async () => {
      const existingResource = createResourceFixture();
      let resolveUpdate!: (value: unknown) => void;
      vi.mocked(documentService.updateDocument).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpdate = resolve;
          }) as any,
      );

      const { result } = renderHook(() => useFileStore(), { wrapper });

      act(() => {
        useFileStore.setState(
          {
            documentMap: { 'doc-1': { document: lobeDocument() } },
            queryParams: { libraryId: 'kb-1', parentId: null },
            resourceList: [existingResource],
            resourceMap: new Map([[existingResource.id, existingResource]]),
          },
          false,
        );
      });

      let pendingUpdate!: Promise<void>;
      act(() => {
        pendingUpdate = result.current.updateDocumentOptimistically('doc-1', {
          title: 'Optimistic title',
        });
      });

      expect(useFileStore.getState().documentMap['doc-1']?.document?.title).toBe(
        'Optimistic title',
      );
      expect(useFileStore.getState().resourceMap.get('doc-1')).toMatchObject({
        _optimistic: {
          isPending: true,
          queryKey: getResourceQueryKey(useFileStore.getState().queryParams),
          retryCount: 0,
        },
        name: 'Optimistic title',
        title: 'Optimistic title',
      });

      resolveUpdate({ historyAppended: false, id: 'doc-1', updatedAt: '2026-01-01T00:00:00.000Z' });

      await act(async () => {
        await pendingUpdate;
      });

      expect(useFileStore.getState().documentMap['doc-1']?.document?.title).toBe(
        'Optimistic title',
      );
      expect(useFileStore.getState().resourceMap.get('doc-1')).toMatchObject({
        name: 'Optimistic title',
        title: 'Optimistic title',
      });
      expect(useFileStore.getState().resourceMap.get('doc-1')?._optimistic).toBeUndefined();
    });

    it('reverts the replica and the resource when the sync fails', async () => {
      const existingResource = createResourceFixture();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(documentService.updateDocument).mockRejectedValue(new Error('sync failed'));

      const { result } = renderHook(() => useFileStore(), { wrapper });

      act(() => {
        useFileStore.setState(
          {
            documentMap: { 'doc-1': { document: lobeDocument() } },
            queryParams: { libraryId: 'kb-1', parentId: null },
            resourceList: [existingResource],
            resourceMap: new Map([[existingResource.id, existingResource]]),
          },
          false,
        );
      });

      await act(async () => {
        await result.current.updateDocumentOptimistically('doc-1', { title: 'Broken title' });
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(useFileStore.getState().documentMap['doc-1']?.document?.title).toBe('Old title');
      expect(useFileStore.getState().resourceMap.get('doc-1')).toMatchObject({
        name: 'Old title',
        title: 'Old title',
      });
      expect(useFileStore.getState().resourceMap.get('doc-1')?._optimistic).toBeUndefined();
    });

    it('does not send content or editorData when only the title changes', async () => {
      const initializedEditorData = {
        root: {
          children: [{ children: [], type: 'paragraph', version: 1 }],
          root: { type: 'root', version: 1 },
        },
      } as any;

      vi.mocked(documentService.updateDocument).mockResolvedValue({
        historyAppended: false,
        id: 'doc-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as any);

      const { result } = renderHook(() => useFileStore(), { wrapper });

      act(() => {
        useFileStore.setState(
          { documentMap: { 'doc-1': { document: lobeDocument({ content: '', editorData: {} }) } } },
          false,
        );
      });

      await act(async () => {
        await result.current.updateDocumentOptimistically('doc-1', {
          content: 'Body written by page agent.',
          editorData: initializedEditorData,
        });
      });

      await act(async () => {
        await result.current.updateDocumentOptimistically('doc-1', {
          metadata: { emoji: 'page' },
          title: 'Final title',
        });
      });

      expect(documentService.updateDocument).toHaveBeenNthCalledWith(1, {
        content: 'Body written by page agent.',
        editorData: JSON.stringify(initializedEditorData),
        id: 'doc-1',
        metadata: {},
        parentId: undefined,
        title: 'Old title',
      });
      expect(documentService.updateDocument).toHaveBeenNthCalledWith(2, {
        id: 'doc-1',
        metadata: { emoji: 'page' },
        parentId: undefined,
        title: 'Final title',
      });
    });

    it('keeps a list row whose library/parent are unknown when its title is saved', async () => {
      const existingResource = createResourceFixture();
      delete existingResource.knowledgeBaseId;
      delete existingResource.parentId;

      vi.mocked(documentService.updateDocument).mockResolvedValue({
        historyAppended: false,
        id: 'doc-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as any);

      const { result } = renderHook(() => useFileStore(), { wrapper });

      act(() => {
        useFileStore.setState(
          {
            documentMap: { 'doc-1': { document: lobeDocument() } },
            queryParams: { libraryId: 'kb-1', parentId: null },
            resourceList: [existingResource],
            resourceMap: new Map([[existingResource.id, existingResource]]),
          },
          false,
        );
      });

      await act(async () => {
        await result.current.updateDocumentOptimistically('doc-1', { title: 'Typed title' });
      });

      expect(useFileStore.getState().resourceList.map((item) => item.id)).toEqual(['doc-1']);
      expect(useFileStore.getState().resourceMap.get('doc-1')).toMatchObject({
        name: 'Typed title',
      });
    });

    it('drops the row on delete and restores it when the server rejects', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(documentService.deleteDocument).mockRejectedValue(new Error('delete failed'));

      const { result } = renderHook(() => useFileStore(), { wrapper });

      act(() => {
        useFileStore.setState({ documentMap: { 'doc-1': { document: lobeDocument() } } }, false);
      });

      await act(async () => {
        await expect(result.current.removeDocument('doc-1')).rejects.toThrow('delete failed');
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(useFileStore.getState().documentMap['doc-1']?.document).toMatchObject({
        id: 'doc-1',
        title: 'Old title',
      });
    });

    it('drops the row once the delete succeeds', async () => {
      vi.mocked(documentService.deleteDocument).mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileStore(), { wrapper });

      act(() => {
        useFileStore.setState({ documentMap: { 'doc-1': { document: lobeDocument() } } }, false);
      });

      await act(async () => {
        await result.current.removeDocument('doc-1');
      });

      expect(useFileStore.getState().documentMap['doc-1']).toBeUndefined();
    });
  });
});
