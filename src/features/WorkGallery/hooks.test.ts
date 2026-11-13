/**
 * @vitest-environment happy-dom
 */
import { randomUUID } from 'node:crypto';

import type { WorkSummaryItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { documentService } from '@/services/document';
import { workService } from '@/services/work';
import { initialWorkState, useWorkStore } from '@/store/work';
import { workspaceWorksResource } from '@/store/work/projection';

import { useWorkspaceWorksInfinite } from './hooks';

const mocks = vi.hoisted(() => ({
  deleteDocument: vi.fn(),
  deleteDocuments: vi.fn(),
  listByWorkspace: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: { listVisibility: string }) => unknown) =>
    selector({ listVisibility: 'private' }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    document: {
      deleteDocument: { mutate: (...args: unknown[]) => mocks.deleteDocument(...args) },
      deleteDocuments: { mutate: (...args: unknown[]) => mocks.deleteDocuments(...args) },
    },
    work: {
      listByWorkspace: { query: (...args: unknown[]) => mocks.listByWorkspace(...args) },
    },
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

const summary = (id: string, title = id) =>
  ({ id, resourceType: 'document', title, type: 'document' }) as unknown as WorkSummaryItem;

const ALL = { workspaceId: null };

let scope = '';

beforeEach(() => {
  scope = `gallery-user-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  act(() => useWorkStore.setState({ ...initialWorkState }));
  mocks.deleteDocument.mockResolvedValue(undefined);
  mocks.deleteDocuments.mockResolvedValue(undefined);
  mocks.listByWorkspace.mockResolvedValue({ items: [summary('wk_1')], nextCursor: null });
});

afterEach(async () => {
  await workspaceWorksResource.storage!.remove({
    queryKey: workspaceWorksResource.storageKey(ALL),
    scope,
  });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useWorkspaceWorksInfinite', () => {
  it('paints the last stored works on a revisit without an initial loading state', async () => {
    await workspaceWorksResource.storage!.set(
      { queryKey: workspaceWorksResource.storageKey(ALL), scope },
      {
        data: {
          currentPage: 0,
          hasMore: false,
          items: [summary('wk_1', 'Cached')],
          nextCursor: null,
          pageSize: 1,
          pages: [{ count: 1, next: null }],
        },
        updatedAt: 1,
      },
    );
    mocks.listByWorkspace.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useWorkspaceWorksInfinite('all'), { wrapper });

    await waitFor(() => expect(result.current.items.map((i) => i.title)).toEqual(['Cached']));
    expect(result.current.isLoadingInitial).toBe(false);
    expect(result.current.isValidating).toBe(true);
  });

  it('pages forward with the cursor of the loaded head page', async () => {
    mocks.listByWorkspace
      .mockResolvedValueOnce({ items: [summary('wk_1')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [summary('wk_2')], nextCursor: null });
    const { result } = renderHook(() => useWorkspaceWorksInfinite('all'), { wrapper });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['wk_1', 'wk_2']));
    expect(mocks.listByWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'c1', includeFileWorks: true, limit: 30 }),
    );
    expect(result.current.hasMore).toBe(false);
  });

  it.each([
    ['one document', () => documentService.deleteDocument('doc-1')],
    ['multiple documents', () => documentService.deleteDocuments(['doc-1', 'doc-2'])],
  ])('refreshes the mounted gallery after deleting %s', async (_label, removeDocuments) => {
    const { result, unmount } = renderHook(() => useWorkspaceWorksInfinite('all'), { wrapper });
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['wk_1']));
    mocks.listByWorkspace.mockResolvedValue({ items: [summary('wk_2')], nextCursor: null });

    await act(removeDocuments);

    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['wk_2']));
    unmount();
  });

  it('keeps a completed document deletion successful when gallery refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(workService, 'refreshWorkspaceLists').mockRejectedValueOnce(
      new Error('refresh failed'),
    );

    await expect(documentService.deleteDocument('doc-1')).resolves.toBeUndefined();

    expect(mocks.deleteDocument).toHaveBeenCalledWith({ id: 'doc-1' });
    expect(consoleError).toHaveBeenCalledWith(
      '[DocumentService] Failed to refresh Works after document deletion:',
      expect.any(Error),
    );
  });
});
