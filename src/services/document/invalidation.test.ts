import { replicaKeys } from '@lobechat/replica';
import { act, renderHook, waitFor } from '@testing-library/react';
import useSWR from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { documentDetailResource } from '@/store/document/slices/document/projection';

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
});
