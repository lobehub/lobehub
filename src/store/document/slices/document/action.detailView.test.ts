/**
 * @vitest-environment happy-dom
 *
 * Read-only views (portal document, goal result / deliverable reader, resource
 * page preview) read the document detail replica without an editor through
 * `useFetchDocumentDetail`: they share the editor's persisted row, paint it
 * after a reload and fold renames / saves into the same entry.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { documentService } from '@/services/document';

import { useDocumentStore } from '../../store';
import { documentDetailResource } from './projection';
import { detailSliceState, documentRow, pending, storedRow, wrapper } from './testUtils';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/services/document', () => ({
  documentService: {
    getDocumentById: vi.fn(),
    updateDocument: vi.fn(),
  },
}));

vi.mock('@/store/page', () => ({
  pageActions: { upsertDocument: vi.fn() },
}));

describe('document detail without an editor (portal / goal / preview views)', () => {
  const scopes = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  const renderDetail = (documentId: string) =>
    renderHook(() => useDocumentStore.getState().useFetchDocumentDetail(documentId), { wrapper });

  beforeEach(() => {
    useScope(`document-detail-user-${randomUUID()}:personal`);
    act(() => useDocumentStore.setState(detailSliceState()));
    vi.mocked(documentService.getDocumentById).mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].map((value) =>
        documentDetailResource.storage!.remove({ queryKey: 'doc-1', scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('bounds the persisted documents it shares with the editor', () => {
    expect(documentDetailResource.maxPersistedEntries).toBeGreaterThan(0);
  });

  it('paints the persisted document after a reload, then swaps in the refreshed row', async () => {
    // A previous session left this row behind; the network is slow.
    await documentDetailResource.storage!.set(
      { queryKey: 'doc-1', scope },
      { data: { document: documentRow({ title: 'Cached title' }) }, updatedAt: 1 },
    );
    let answer: (row: unknown) => void = () => {};
    vi.mocked(documentService.getDocumentById).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as any,
    );

    const { result } = renderDetail('doc-1');

    await waitFor(() => expect(result.current.data?.title).toBe('Cached title'));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.isValidating).toBe(true);

    await act(async () => {
      answer(
        documentRow({ title: 'Fresh title', updatedAt: new Date('2026-01-03T00:00:00.000Z') }),
      );
    });

    await waitFor(() => expect(result.current.data?.title).toBe('Fresh title'));
    await waitFor(async () =>
      expect((await storedRow('doc-1', scope))?.data.document?.title).toBe('Fresh title'),
    );
  });

  it.each(['FORBIDDEN', 'UNAUTHORIZED'])(
    'purges the cached document when the refresh is denied (%s)',
    async (code) => {
      await documentDetailResource.storage!.set(
        { queryKey: 'doc-1', scope },
        { data: { document: documentRow({ title: 'Revoked' }) }, updatedAt: 1 },
      );
      let deny: (error: unknown) => void = () => {};
      vi.mocked(documentService.getDocumentById).mockImplementation(
        () => new Promise((_, reject) => (deny = reject)) as any,
      );

      const { result } = renderDetail('doc-1');
      await waitFor(() => expect(result.current.data?.title).toBe('Revoked'));

      await act(async () => {
        deny(Object.assign(new Error(code), { data: { code } }));
      });

      await waitFor(() => expect(result.current.data).toBeUndefined());
      expect(result.current.error).toBeDefined();
      await waitFor(async () => expect(await storedRow('doc-1', scope)).toBeUndefined());
    },
  );

  it('keeps the cached document when the refresh fails transiently', async () => {
    await documentDetailResource.storage!.set(
      { queryKey: 'doc-1', scope },
      { data: { document: documentRow({ title: 'Cached' }) }, updatedAt: 1 },
    );
    vi.mocked(documentService.getDocumentById).mockRejectedValue(new Error('Failed to fetch'));

    const { result } = renderDetail('doc-1');

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data?.title).toBe('Cached');
    expect((await storedRow('doc-1', scope))?.data.document?.title).toBe('Cached');
  });

  it('reports loading only once the persisted row is known to be absent', async () => {
    vi.mocked(documentService.getDocumentById).mockImplementation(pending as any);

    const { result } = renderDetail('doc-1');

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it('rolls an optimistic rename back when the server rejects it', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(
      documentRow({ title: 'Old' }) as any,
    );
    const { result } = renderDetail('doc-1');
    await waitFor(() => expect(result.current.data?.title).toBe('Old'));

    let reject: (error: Error) => void = () => {};
    let rename: Promise<unknown> = Promise.resolve();
    act(() => {
      rename = useDocumentStore
        .getState()
        .optimisticDocumentDetail(
          'doc-1',
          { title: 'New' },
          () => new Promise((_, fail) => (reject = fail)),
        );
    });
    expect(result.current.data?.title).toBe('New');

    await act(async () => {
      reject(new Error('rename failed'));
      await rename.catch(() => undefined);
    });
    expect(result.current.data?.title).toBe('Old');
  });

  it('folds a confirmed save into the entry without a refetch', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(
      documentRow({ content: 'before' }) as any,
    );
    const { result } = renderDetail('doc-1');
    await waitFor(() => expect(result.current.data?.content).toBe('before'));
    const calls = vi.mocked(documentService.getDocumentById).mock.calls.length;

    act(() =>
      useDocumentStore.getState().beginDocumentDetailPatch('doc-1')({
        content: 'saved',
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
      }),
    );

    expect(result.current.data?.content).toBe('saved');
    expect(vi.mocked(documentService.getDocumentById).mock.calls.length).toBe(calls);
    await waitFor(async () =>
      expect((await storedRow('doc-1', scope))?.data.document?.content).toBe('saved'),
    );
  });

  it('drops a save that settles under another identity', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(
      documentRow({ content: 'before' }) as any,
    );
    const { result } = renderDetail('doc-1');
    await waitFor(() => expect(result.current.data?.content).toBe('before'));
    const previous = scope;

    // The save starts in one identity…
    const commit = useDocumentStore.getState().beginDocumentDetailPatch('doc-1');
    // …and settles after a switch, while the old row is still in memory.
    useScope(`document-detail-user-${randomUUID()}:personal`);
    act(() => commit({ content: 'saved-by-previous-identity' }));

    expect(result.current.data?.content).not.toBe('saved-by-previous-identity');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(await storedRow('doc-1', scope)).toBeUndefined();
    expect((await storedRow('doc-1', previous))?.data.document?.content).not.toBe(
      'saved-by-previous-identity',
    );
  });

  it('does not let a rename confirmed after an identity switch hold back the new scope’s read', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(
      documentRow({ title: 'Old' }) as any,
    );
    const { rerender, result } = renderDetail('doc-1');
    await waitFor(() => expect(result.current.data?.title).toBe('Old'));

    // A rename starts under this identity…
    let confirm: () => void = () => {};
    let rename: Promise<unknown> = Promise.resolve();
    act(() => {
      rename = useDocumentStore
        .getState()
        .optimisticDocumentDetail(
          'doc-1',
          { title: 'Renamed' },
          () => new Promise<void>((resolve) => (confirm = resolve)),
        );
    });

    // …the user switches identity, and that identity reads the same id.
    let answer: (row: unknown) => void = () => {};
    vi.mocked(documentService.getDocumentById).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as any,
    );
    const nextScope = `document-detail-user-${randomUUID()}:personal`;
    // That identity has its own persisted copy, hydrated before its read answers.
    await documentDetailResource.storage!.set(
      { queryKey: 'doc-1', scope: nextScope },
      { data: { document: documentRow({ title: 'Other identity (cached)' }) }, updatedAt: 1 },
    );
    useScope(nextScope);
    rerender();
    await waitFor(() => expect(result.current.data?.title).toBe('Other identity (cached)'));
    await waitFor(() => expect(documentService.getDocumentById).toHaveBeenCalledTimes(2));

    // The old rename settles first, then the new identity's read answers.
    await act(async () => {
      confirm();
      await rename.catch(() => undefined);
    });
    await act(async () => {
      answer(documentRow({ title: 'Other identity (fresh)' }));
    });

    await waitFor(() => expect(result.current.data?.title).toBe('Other identity (fresh)'));
  });

  it('keeps a confirmed rename over a read that started before it', async () => {
    await documentDetailResource.storage!.set(
      { queryKey: 'doc-1', scope },
      { data: { document: documentRow({ title: 'Old' }) }, updatedAt: 1 },
    );
    let answer: (row: unknown) => void = () => {};
    vi.mocked(documentService.getDocumentById).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as any,
    );
    const { result } = renderDetail('doc-1');
    await waitFor(() => expect(result.current.data?.title).toBe('Old'));

    // The mount-time read is still in flight when the rename is confirmed.
    await act(async () => {
      await useDocumentStore
        .getState()
        .optimisticDocumentDetail('doc-1', { title: 'New' }, () => Promise.resolve());
    });
    expect(result.current.data?.title).toBe('New');

    // …then it settles with the pre-rename row (same `updatedAt`).
    await act(async () => {
      answer(documentRow({ title: 'Old' }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.data?.title).toBe('New');
    await waitFor(async () =>
      expect((await storedRow('doc-1', scope))?.data.document?.title).toBe('New'),
    );
  });
});
