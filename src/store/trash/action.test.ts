import type { TrashItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { trashService } from '@/services/trash';

import { trashSelectors } from './selectors';
import { useTrashStore } from './store';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

const scopeMock = vi.hoisted(() => ({ current: 'u1:personal' }));
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => scopeMock.current,
  useCacheScope: () => scopeMock.current,
}));

const buildItem = (overrides: Partial<TrashItem> = {}): TrashItem => ({
  deletedAt: new Date('2026-08-01T00:00:00Z'),
  deletedByUserId: 'u1',
  expiresAt: new Date('2026-08-31T00:00:00Z'),
  id: 'trash_1',
  meta: null,
  resourceId: 'tpc_1',
  resourceType: 'topic',
  rootId: null,
  title: 'A topic',
  userId: 'u1',
  workspaceId: null,
  ...overrides,
});

describe('TrashAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mutate).mockResolvedValue(undefined as never);
    useTrashStore.setState({
      activeType: undefined,
      countByType: { agent: 1, topic: 2 },
      isTrashInit: true,
      items: [buildItem(), buildItem({ id: 'trash_2', resourceId: 'tpc_2' })],
      isLoadingMore: false,
      loadingIds: [],
      nextCursor: null,
      scope: 'u1:personal',
    });
    scopeMock.current = 'u1:personal';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('restore', () => {
    it('drops restored rows, keeps blocked ones, and revalidates the lists a restore touches', async () => {
      vi.spyOn(trashService, 'restore').mockResolvedValue({
        failed: [{ code: 'parentTrashed', id: 'trash_2' }],
        restored: [buildItem()],
      });

      const outcome = await useTrashStore.getState().restore(['trash_1', 'trash_2']);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: 'trash_2' }]);
      expect(useTrashStore.getState().items.map((i) => i.id)).toEqual(['trash_2']);
      expect(useTrashStore.getState().loadingIds).toEqual([]);
      // recycle-bin list + counts, plus a filter-based sweep of the affected namespaces
      expect(mutate).toHaveBeenCalledWith(['trash:list', 'all']);
      expect(mutate).toHaveBeenCalledWith(['trash:countByType']);
      const filterCall = vi.mocked(mutate).mock.calls.find(([key]) => typeof key === 'function');
      expect(filterCall).toBeTruthy();
      const filter = filterCall![0] as (key: unknown) => boolean;
      expect(filter(['topic:list', 'x', {}])).toBe(true);
      expect(filter(['agent:list', true])).toBe(true);
      expect(filter(['trash:list', 'all'])).toBe(false);
      expect(filter('not-an-array')).toBe(false);
    });

    it('also drops rows the server reported as already gone', async () => {
      vi.spyOn(trashService, 'restore').mockResolvedValue({
        failed: [{ code: 'notFound', id: 'trash_1' }],
        restored: [],
      });
      await useTrashStore.getState().restore(['trash_1']);
      expect(useTrashStore.getState().items.map((i) => i.id)).toEqual(['trash_2']);
      // nothing came back — no cross-store revalidation
      expect(vi.mocked(mutate).mock.calls.some(([key]) => typeof key === 'function')).toBe(false);
    });

    it('marks rows as loading while the call is in flight', async () => {
      let resolve!: () => void;
      vi.spyOn(trashService, 'restore').mockReturnValue(
        new Promise((r) => {
          resolve = () => r({ failed: [], restored: [] });
        }),
      );
      const pending = useTrashStore.getState().restore(['trash_1']);
      expect(trashSelectors.isLoading('trash_1')(useTrashStore.getState())).toBe(true);
      resolve();
      await pending;
      expect(trashSelectors.isLoading('trash_1')(useTrashStore.getState())).toBe(false);
    });
  });

  describe('purge / emptyTrash', () => {
    it('purge removes the rows locally and refreshes the bin', async () => {
      vi.spyOn(trashService, 'purge').mockResolvedValue({ purged: 1 });
      await useTrashStore.getState().purge(['trash_1']);
      expect(trashService.purge).toHaveBeenCalledWith(['trash_1']);
      expect(useTrashStore.getState().items.map((i) => i.id)).toEqual(['trash_2']);
    });

    it('emptyTrash honours the active type filter and clears the list', async () => {
      vi.spyOn(trashService, 'emptyTrash').mockResolvedValue({ hasMore: false, purged: 2 });
      useTrashStore.setState({ activeType: 'topic' });
      await useTrashStore.getState().emptyTrash();
      expect(trashService.emptyTrash).toHaveBeenCalledWith('topic');
      expect(useTrashStore.getState().items).toEqual([]);
      expect(mutate).toHaveBeenCalledWith(['trash:list', 'topic']);
    });

    it('emptyTrash keeps calling while the server reports more batches', async () => {
      vi.spyOn(trashService, 'emptyTrash')
        .mockResolvedValueOnce({ hasMore: true, purged: 50 })
        .mockResolvedValueOnce({ hasMore: true, purged: 50 })
        .mockResolvedValueOnce({ hasMore: false, purged: 7 });
      await useTrashStore.getState().emptyTrash();
      expect(trashService.emptyTrash).toHaveBeenCalledTimes(3);
      expect(useTrashStore.getState().items).toEqual([]);
    });
  });

  describe('paging / filter', () => {
    it('setActiveType resets the list so the new filter starts from a fresh first page', () => {
      useTrashStore.setState({ nextCursor: 'abc' });
      useTrashStore.getState().setActiveType('agent');
      expect(useTrashStore.getState()).toMatchObject({
        activeType: 'agent',
        isTrashInit: false,
        items: [],
        nextCursor: null,
      });
    });

    it('loadMore appends the next page', async () => {
      useTrashStore.setState({ nextCursor: 'cursor-1' });
      vi.spyOn(trashService, 'list').mockResolvedValue({
        items: [buildItem({ id: 'trash_3', resourceId: 'tpc_3' })],
        nextCursor: null,
      });
      await useTrashStore.getState().loadMore();
      expect(trashService.list).toHaveBeenCalledWith({
        cursor: 'cursor-1',
        resourceType: undefined,
      });
      expect(useTrashStore.getState().items.map((i) => i.id)).toEqual([
        'trash_1',
        'trash_2',
        'trash_3',
      ]);
      expect(useTrashStore.getState().nextCursor).toBeNull();
    });

    it('loadMore fetches a cursor once even when clicked twice', async () => {
      useTrashStore.setState({ nextCursor: 'cursor-1' });
      vi.spyOn(trashService, 'list').mockResolvedValue({
        items: [buildItem({ id: 'trash_3', resourceId: 'tpc_3' })],
        nextCursor: null,
      });
      await Promise.all([useTrashStore.getState().loadMore(), useTrashStore.getState().loadMore()]);
      expect(trashService.list).toHaveBeenCalledTimes(1);
      expect(useTrashStore.getState().items.map((i) => i.id)).toEqual([
        'trash_1',
        'trash_2',
        'trash_3',
      ]);
    });

    it('loadMore drops a page that lands after the filter changed', async () => {
      useTrashStore.setState({ nextCursor: 'cursor-1' });
      let resolve!: (value: Awaited<ReturnType<typeof trashService.list>>) => void;
      vi.spyOn(trashService, 'list').mockReturnValue(new Promise((r) => (resolve = r)));

      const pending = useTrashStore.getState().loadMore();
      useTrashStore.getState().setActiveType('agent');
      resolve({ items: [buildItem({ id: 'trash_3', resourceId: 'tpc_3' })], nextCursor: null });
      await pending;

      expect(useTrashStore.getState().items).toEqual([]);
      expect(useTrashStore.getState().isLoadingMore).toBe(false);
    });
  });

  describe('workspace scope', () => {
    it("clears the previous scope's rows when the workspace switches", () => {
      const { rerender } = renderHook(() => useTrashStore.getState().useFetchTrash(true));
      expect(useTrashStore.getState().items).toHaveLength(2);

      scopeMock.current = 'u1:ws-2';
      rerender();

      expect(useTrashStore.getState()).toMatchObject({
        countByType: {},
        isTrashInit: false,
        items: [],
        nextCursor: null,
        scope: 'u1:ws-2',
      });
    });

    it('ignores a list response that belongs to a scope the user has left', () => {
      renderHook(() => useTrashStore.getState().useFetchTrash(true));
      const options = vi.mocked(useClientDataSWR).mock.calls.at(-1)![2] as {
        onSuccess: (data: unknown) => void;
      };

      scopeMock.current = 'u1:ws-2';
      options.onSuccess({ items: [buildItem({ id: 'stale' })], nextCursor: null });

      expect(useTrashStore.getState().items.map((i) => i.id)).not.toContain('stale');
    });
  });

  describe('selectors', () => {
    it('totalCount sums the per-type counts', () => {
      expect(trashSelectors.totalCount(useTrashStore.getState())).toBe(3);
    });
  });
});
