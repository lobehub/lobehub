import { act, renderHook, waitFor } from '@testing-library/react';
import useSWR from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { portalKeys } from '@/libs/swr/keys';

import { invalidateDocumentMutation } from './invalidation';

vi.mock('@/libs/swr', async () => ({ mutate: (await import('swr')).mutate }));

describe('invalidateDocumentMutation', () => {
  it('refreshes mounted Portal content and title after a document write', async () => {
    let row = { content: 'Before', title: 'Old title' };
    const fetcher = vi.fn(async () => row);
    const otherFetcher = vi.fn(async () => ({ content: 'Other document' }));
    const { result } = renderHook(() => ({
      document: useSWR(portalKeys.documentHeader('changed-document'), fetcher),
      other: useSWR(portalKeys.documentHeader('untouched-document'), otherFetcher),
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
