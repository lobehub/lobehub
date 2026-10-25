import { act, renderHook, waitFor } from '@testing-library/react';
import { replicaKeys } from 'local-replica';
import useSWR from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';
import { documentDetailResource } from '@/store/document/slices/document/projection';
import { fileDocumentResource } from '@/store/file/slices/document/projection';

import { invalidateDocumentMutation } from './invalidation';

vi.mock('@/libs/swr', async () => ({ mutate: (await import('swr')).mutate }));

// The sync query the portal / page views mount for one document's replica entry.
const documentDetailSyncKey = (documentId: string) =>
  replicaKeys.sync(
    documentDetailResource.name,
    documentDetailResource.version,
    documentDetailResource.scope.get(),
    documentId,
    documentId,
  );

describe('invalidateDocumentMutation', () => {
  it('refreshes mounted Portal content and title after a document write', async () => {
    let row = { content: 'Before', title: 'Old title' };
    const fetcher = vi.fn(async () => row);
    const otherFetcher = vi.fn(async () => ({ content: 'Other document' }));
    const { result } = renderHook(() => ({
      document: useSWR(documentDetailSyncKey('changed-document'), fetcher),
      other: useSWR(documentDetailSyncKey('untouched-document'), otherFetcher),
    }));
    await waitFor(() => expect(result.current.document.data?.title).toBe('Old title'));
    await waitFor(() => expect(result.current.other.data?.content).toBe('Other document'));
    const otherCalls = otherFetcher.mock.calls.length;

    row = { content: 'After tool write', title: 'Renamed by tool' };
    await act(async () => {
      await invalidateDocumentMutation({ documentId: 'changed-document' });
    });

    expect(result.current.document.data).toEqual(row);
    expect(otherFetcher).toHaveBeenCalledTimes(otherCalls);
  });
  it('refreshes saved resource metadata without rewriting it or rehydrating a dirty editor', async () => {
    const id = 'metadata-only-document';
    const mutation = vi.spyOn(documentService, 'updateDocument');
    let row = { title: 'Before' };
    const fileFetcher = vi.fn(async () => row);
    const editorFetcher = vi.fn(async () => ({ content: 'Saved body' }));
    const { result } = renderHook(() => ({
      document: useSWR(
        replicaKeys.sync(
          fileDocumentResource.name,
          fileDocumentResource.version,
          fileDocumentResource.scope.get(),
          id,
          id,
        ),
        fileFetcher,
      ),
      editor: useSWR(documentDetailSyncKey(id), editorFetcher),
    }));
    await waitFor(() => expect(result.current.document.data?.title).toBe('Before'));
    await waitFor(() => expect(result.current.editor.data?.content).toBe('Saved body'));
    const editorCalls = editorFetcher.mock.calls.length;
    row = { title: 'Already saved' };

    await act(async () => {
      await invalidateDocumentMutation({
        documentId: id,
        refreshDocumentEditor: false,
        refreshResources: true,
      });
    });

    expect(result.current.document.data?.title).toBe('Already saved');
    expect(editorFetcher).toHaveBeenCalledTimes(editorCalls);
    expect(mutation).not.toHaveBeenCalled();
    mutation.mockRestore();
  });
});
