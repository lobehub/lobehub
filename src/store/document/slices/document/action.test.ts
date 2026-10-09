/**
 * @vitest-environment happy-dom
 *
 * The document detail is a replica: one row per document id, persisted per
 * identity scope, so the editor's first frame comes from the projection and the
 * network only confirms it. This suite drives the real sync path (SWR provider +
 * the app's scoped mutate) instead of poking the store.
 */
import { randomUUID } from 'node:crypto';

import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { documentService } from '@/services/document';
import { initialEditorState } from '@/store/document/slices/editor';

import { useDocumentStore } from '../../store';
import { initialDocumentDetailSliceState } from './initialState';
import { documentDetailResource } from './projection';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  upsertDocument: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => mocks.activeWorkspaceId,
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/services/document', () => ({
  documentService: {
    getDocumentById: vi.fn(),
    updateDocument: vi.fn(),
  },
}));

vi.mock('@/store/page', () => ({
  pageActions: { upsertDocument: mocks.upsertDocument },
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

const baseEditorData = {
  root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
};

/** A document row as the server returns it. */
const documentRow = (overrides: Record<string, unknown> = {}) =>
  ({
    content: '# Server',
    editorData: baseEditorData,
    id: 'doc-1',
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }) as any;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const createEditor = () => ({
  getDocument: vi.fn((type: string) => {
    if (type === 'markdown') return '# Draft';
    if (type === 'json') return baseEditorData;
    return null;
  }),
  getLexicalEditor: vi.fn(),
  setDocument: vi.fn(),
});

const renderDocument = (
  documentId: string,
  editor: ReturnType<typeof createEditor>,
  options: Record<string, unknown> = {},
) =>
  renderHook(
    () => useDocumentStore.getState().useFetchDocument(documentId, { editor, ...options }),
    { wrapper },
  );

const storedRow = (documentId: string, scope: string) =>
  documentDetailResource.storage!.get({ queryKey: documentId, scope });

const detailSliceState = () => ({ ...initialEditorState, ...initialDocumentDetailSliceState });

describe('document detail replica', () => {
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
    mocks.activeWorkspaceId = null;
    mocks.upsertDocument.mockClear();
    useScope(`document-user-${randomUUID()}:personal`);
    act(() => useDocumentStore.setState(detailSliceState()));
    vi.mocked(documentService.getDocumentById).mockReset();
    vi.mocked(documentService.updateDocument).mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].map((value) =>
        Promise.all(
          ['doc-1', 'doc-2'].map((id) =>
            documentDetailResource.storage!.remove({ queryKey: id, scope: value }),
          ),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted document into the editor before the network answers', async () => {
    const cached = documentRow({ content: '# Cached' });
    await documentDetailResource.storage!.set(
      { queryKey: 'doc-1', scope },
      { data: { document: cached }, updatedAt: 1 },
    );
    vi.mocked(documentService.getDocumentById).mockImplementation(pending as any);

    const editor = createEditor();
    const { result } = renderDocument('doc-1', editor);

    await waitFor(() =>
      expect(useDocumentStore.getState().documents['doc-1']?.content).toBe('# Cached'),
    );
    expect(useDocumentStore.getState().documentDetailMap['doc-1']).toEqual({ document: cached });
    expect(result.current.data?.content).toBe('# Cached');
    expect(result.current.isLoading).toBe(false);
    // The network request is still in flight; the frame did not wait for it.
    expect(result.current.isValidating).toBe(true);
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it('adopts a newer server body over a dirty draft when the sync revalidates', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(documentRow() as any);
    const editor = createEditor();
    const { result } = renderDocument('doc-1', editor, {
      sourceType: 'notebook',
      topicId: 'topic-1',
    });

    await waitFor(() => expect(useDocumentStore.getState().documents['doc-1']).toBeDefined());
    act(() => useDocumentStore.getState().handleContentChange());
    expect(useDocumentStore.getState().documents['doc-1'].isDirty).toBe(true);
    expect(useDocumentStore.getState().lastActiveTopicDocumentIdByTopicId).toEqual({
      'topic-1': 'doc-1',
    });

    vi.mocked(documentService.getDocumentById).mockResolvedValue(
      documentRow({
        content: '# Agent write',
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      }) as any,
    );
    await act(async () => {
      await result.current.mutate();
    });

    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Agent write',
      isDirty: false,
      lastSavedContent: '# Agent write',
      lastUpdatedTime: new Date('2026-01-03T00:00:00.000Z'),
      saveStatus: 'saved',
    });
  });

  it('keeps the dirty draft when only the server version moved', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(documentRow() as any);
    const editor = createEditor();
    const { result } = renderDocument('doc-1', editor);

    await waitFor(() => expect(useDocumentStore.getState().documents['doc-1']).toBeDefined());
    act(() => useDocumentStore.getState().handleContentChange());

    vi.mocked(documentService.getDocumentById).mockResolvedValue(
      documentRow({ updatedAt: new Date('2026-01-05T00:00:00.000Z') }) as any,
    );
    await act(async () => {
      await result.current.mutate();
    });

    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Draft',
      isDirty: true,
      lastSavedContent: '# Server',
      lastUpdatedTime: new Date('2026-01-05T00:00:00.000Z'),
    });
  });

  it('ignores a replayed row older than the version saved since', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(documentRow() as any);
    vi.mocked(documentService.updateDocument).mockResolvedValue({
      historyAppended: false,
      id: 'doc-1',
      updatedAt: '2026-01-06T00:00:00.000Z',
    } as any);
    const editor = createEditor();
    const { result } = renderDocument('doc-1', editor);

    await waitFor(() => expect(useDocumentStore.getState().documents['doc-1']).toBeDefined());
    act(() => useDocumentStore.getState().handleContentChange());
    await act(async () => {
      await useDocumentStore.getState().performSave('doc-1');
    });
    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Draft',
      isDirty: false,
      lastUpdatedTime: new Date('2026-01-06T00:00:00.000Z'),
    });

    vi.mocked(documentService.getDocumentById).mockResolvedValue(
      documentRow({ content: '# Server', updatedAt: new Date('2026-01-01T00:00:00.000Z') }) as any,
    );
    await act(async () => {
      await result.current.mutate();
    });

    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Draft',
      isDirty: false,
      lastSavedContent: '# Draft',
      lastUpdatedTime: new Date('2026-01-06T00:00:00.000Z'),
    });
  });

  it('mirrors page metadata into the page store on the reconcile path', async () => {
    const first = documentRow();
    vi.mocked(documentService.getDocumentById).mockResolvedValue(first as any);
    const editor = createEditor();
    const { result } = renderDocument('doc-1', editor, { sourceType: 'page' });

    await waitFor(() => expect(mocks.upsertDocument).toHaveBeenCalledWith(first));

    const newer = documentRow({ updatedAt: new Date('2026-01-07T00:00:00.000Z') });
    vi.mocked(documentService.getDocumentById).mockResolvedValue(newer as any);
    await act(async () => {
      await result.current.mutate();
    });

    expect(mocks.upsertDocument).toHaveBeenCalledWith(newer);
  });

  it('resolves a missing document to not found and never persists the marker', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(undefined as any);
    const editor = createEditor();
    const { result } = renderDocument('doc-1', editor);

    await waitFor(() =>
      expect(useDocumentStore.getState().documentDetailMap['doc-1']).toEqual({ document: null }),
    );
    expect(result.current.data).toBeNull();
    // No editor entry is created for a document that does not exist.
    expect(useDocumentStore.getState().documents['doc-1']).toBeUndefined();
    expect(await storedRow('doc-1', scope)).toBeUndefined();
  });

  it('initializes the editor in the same commit that the projection lands in', async () => {
    const cached = documentRow({ content: '# Cached' });
    await documentDetailResource.storage!.set(
      { queryKey: 'doc-1', scope },
      { data: { document: cached }, updatedAt: 1 },
    );
    vi.mocked(documentService.getDocumentById).mockImplementation(pending as any);

    const editor = createEditor();
    const commits: Array<{ editorReady: boolean; view: boolean }> = [];
    const Probe = () => {
      const view = useDocumentStore((s) => Boolean(s.documentDetailMap['doc-1']));
      const editorReady = useDocumentStore((s) => Boolean(s.documents['doc-1']));
      commits.push({ editorReady, view });
      useDocumentStore((s) => s.useFetchDocument)('doc-1', { editor, sourceType: 'page' });
      return null;
    };

    render(createElement(Probe), { wrapper });
    await waitFor(() => expect(useDocumentStore.getState().documents['doc-1']).toBeDefined());

    // No committed render may show the projection holding the document while the
    // editor state is still missing: that frame is the skeleton flash a repeat
    // visit is supposed to be free of.
    expect(commits.filter((c) => c.view && !c.editorReady)).toEqual([]);
    expect(useDocumentStore.getState().documents['doc-1']?.content).toBe('# Cached');
  });

  it('drops the previous identity’s document, projection and editor state included', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(documentRow() as any);
    const editor = createEditor();
    const sync = renderDocument('doc-1', editor);
    await waitFor(() =>
      expect(useDocumentStore.getState().documentDetailMap['doc-1']).toBeDefined(),
    );
    expect(useDocumentStore.getState().documents['doc-1']).toBeDefined();

    vi.mocked(documentService.getDocumentById).mockImplementation(pending as any);
    useScope(`document-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() =>
      expect(useDocumentStore.getState().documentDetailMap['doc-1']).toBeUndefined(),
    );
    // The editor bucket derived from the previous identity goes with the
    // projection. `DocumentIdMode` gates "loaded" on `documents[id]`, so leaving
    // it behind keeps rendering the previous scope's body.
    expect(useDocumentStore.getState().documents['doc-1']).toBeUndefined();
  });

  it('keeps no previous-identity editor state when the new scope’s fetch fails', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(documentRow() as any);
    const editor = createEditor();
    const sync = renderDocument('doc-1', editor);
    await waitFor(() => expect(useDocumentStore.getState().documents['doc-1']).toBeDefined());

    // The new identity's read fails: nothing may fall back to the old body.
    vi.mocked(documentService.getDocumentById).mockRejectedValue(new Error('offline') as any);
    useScope(`document-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(sync.result.current.error).toBeDefined());
    expect(useDocumentStore.getState().documentDetailMap['doc-1']).toBeUndefined();
    expect(useDocumentStore.getState().documents['doc-1']).toBeUndefined();
  });

  it('warms the replica for a hover prefetch so the next visit paints from storage', async () => {
    const prefetched = documentRow({ id: 'doc-2', content: '# Prefetched' });
    vi.mocked(documentService.getDocumentById).mockResolvedValue(prefetched as any);

    await act(async () => {
      await useDocumentStore.getState().prefetchDocument('doc-2');
    });

    expect(useDocumentStore.getState().documentDetailMap['doc-2']).toEqual({
      document: prefetched,
    });
    expect((await storedRow('doc-2', scope))?.data).toEqual({ document: prefetched });
  });

  it('does not leak a prefetch fetched under another identity into the new scope', async () => {
    const previousScope = scope;
    const prefetched = documentRow({ id: 'doc-2', content: '# Old identity' });
    let resolveFetch!: (value: unknown) => void;
    vi.mocked(documentService.getDocumentById).mockImplementation(
      () => new Promise((resolve) => (resolveFetch = resolve)) as any,
    );

    const inflight = useDocumentStore.getState().prefetchDocument('doc-2');
    // The identity switches while the request is in flight.
    useScope(`document-user-${randomUUID()}:personal`);
    resolveFetch(prefetched);
    await act(async () => {
      await inflight;
    });

    // The response was fetched under the previous identity, so it may not land
    // in the new identity's memory…
    expect(useDocumentStore.getState().documentDetailMap['doc-2']).toBeUndefined();
    expect(await storedRow('doc-2', scope)).toBeUndefined();
    // …nor in the previous identity's persisted partition.
    expect(await storedRow('doc-2', previousScope)).toBeUndefined();
  });

  it('evicts a previously persisted document when the server no longer has it', async () => {
    // Cached before the document was deleted / became inaccessible.
    const stale = documentRow({ content: '# Revoked' });
    await documentDetailResource.storage!.set(
      { queryKey: 'doc-1', scope },
      { data: { document: stale }, updatedAt: 1 },
    );
    vi.mocked(documentService.getDocumentById).mockResolvedValue(undefined as any);

    const editor = createEditor();
    const { result } = renderDocument('doc-1', editor);

    await waitFor(() =>
      expect(useDocumentStore.getState().documentDetailMap['doc-1']).toEqual({ document: null }),
    );
    expect(result.current.data).toBeNull();
    // The in-memory "not found" marker is kept, but the stale row is gone.
    await waitFor(async () => expect(await storedRow('doc-1', scope)).toBeUndefined());
  });

  it('a reload cannot resurrect a document the server has dropped', async () => {
    const stale = documentRow({ content: '# Revoked' });
    await documentDetailResource.storage!.set(
      { queryKey: 'doc-1', scope },
      { data: { document: stale }, updatedAt: 1 },
    );
    vi.mocked(documentService.getDocumentById).mockResolvedValue(undefined as any);
    const first = renderDocument('doc-1', createEditor());
    await waitFor(async () => expect(await storedRow('doc-1', scope)).toBeUndefined());
    first.unmount();

    // Reload: memory is gone, so only the persisted projection could paint a
    // first frame — and the read that follows fails.
    act(() => useDocumentStore.setState(detailSliceState()));
    vi.mocked(documentService.getDocumentById).mockRejectedValue(new Error('offline') as any);
    const editor = createEditor();
    const second = renderDocument('doc-1', editor);
    await waitFor(() => expect(second.result.current.error).toBeDefined());

    expect(useDocumentStore.getState().documentDetailMap['doc-1']).toBeUndefined();
    expect(useDocumentStore.getState().documents['doc-1']).toBeUndefined();
    expect(editor.setDocument).not.toHaveBeenCalled();
  });
});
