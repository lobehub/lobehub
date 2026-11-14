/**
 * @vitest-environment happy-dom
 *
 * Reload behavior of the acceptance list panel, the workspace shell's list read
 * and the discussion: with last session's rows in IndexedDB, the first frame
 * shows them while the network is still out. Only public hooks and the app's
 * storage adapter are imported, so the same assertions run against the
 * pre-replica SWR hooks (which painted a skeleton instead).
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAcceptanceList, useAcceptanceListInfinite } from '@/features/Acceptance/hooks';
import { useAcceptanceCommentList } from '@/features/Acceptance/Viewer/Comments/useAcceptanceCommentList';
import { AppIndexedDBStorage, cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { acceptanceCommentService } from '@/services/acceptanceComment';
import { verifyService } from '@/services/verify';

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

/** The persisted rows the replicas write: `replica:<name>:v<version>`. */
const storageOf = (name: string) =>
  new AppIndexedDBStorage<any>({ namespace: `replica:${name}:v1` });

const row = (id: string) => ({ id, subject: { title: id }, subjectId: `subject-${id}` });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('acceptance first paint after reload', () => {
  let scope = '';

  beforeEach(() => {
    scope = `first-paint-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('paints the list panel feed from storage, then the server answer', async () => {
    await storageOf('acceptancePage').set(
      { queryKey: 'all|||', scope },
      {
        data: { currentPage: 0, hasMore: false, items: [row('stored')], nextCursor: null },
        updatedAt: 1,
      },
    );
    const network = deferred<unknown>();
    vi.spyOn(verifyService, 'listAcceptancePage').mockReturnValue(network.promise as never);

    const { result } = renderHook(() => useAcceptanceListInfinite('all'), { wrapper });

    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['stored']));
    expect(result.current.isLoadingInitial).toBe(false);

    await act(async () => network.resolve({ items: [row('fresh')], nextCursor: null }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['fresh']));
  });

  it('paints the workspace list read from storage, then the server answer', async () => {
    await storageOf('acceptanceList').set(
      { queryKey: 'all|||||', scope },
      { data: [row('stored')], updatedAt: 1 },
    );
    const network = deferred<unknown>();
    vi.spyOn(verifyService, 'listAcceptances').mockReturnValue(network.promise as never);

    const { result } = renderHook(() => useAcceptanceList(true, { filter: 'all' }), { wrapper });

    await waitFor(() => expect(result.current.data?.map((item) => item.id)).toEqual(['stored']));
    expect(result.current.isLoading).toBe(false);

    await act(async () => network.resolve([row('fresh')]));
    await waitFor(() => expect(result.current.data?.map((item) => item.id)).toEqual(['fresh']));
  });

  it('paints the discussion from storage, then the server answer', async () => {
    const list = (id: string) => ({ canApprove: false, canComment: true, items: [{ id }] });
    await storageOf('acceptanceComment').set(
      { queryKey: 'acc-1', scope },
      { data: list('stored'), updatedAt: 1 },
    );
    const network = deferred<unknown>();
    vi.spyOn(acceptanceCommentService, 'list').mockReturnValue(network.promise as never);

    const { result } = renderHook(() => useAcceptanceCommentList('acc-1'), { wrapper });

    await waitFor(() => expect(result.current.data?.items[0]?.id).toBe('stored'));
    expect(result.current.isLoading).toBe(false);

    await act(async () => network.resolve(list('fresh')));
    await waitFor(() => expect(result.current.data?.items[0]?.id).toBe('fresh'));
  });
});
