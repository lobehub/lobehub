/**
 * @vitest-environment happy-dom
 *
 * Imperative recycle-bin behaviour: restore / purge / empty drop rows from the
 * local-first views, per-row loading flags settle, and a restore revalidates
 * the other stores' lists. The replica wiring itself is covered by
 * `replica.test.ts`.
 */
import type { TrashItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { trashService } from '@/services/trash';

import type { TrashListData } from './initialState';
import { initialState } from './initialState';
import { trashListKey } from './projection';
import { trashSelectors } from './selectors';
import { useTrashStore } from './store';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'u1:personal',
  isScopeTrusted: () => true,
  useCacheScope: () => 'u1:personal',
}));

vi.mock('@/services/trash', () => ({
  trashService: {
    countByType: vi.fn(),
    emptyTrash: vi.fn(),
    list: vi.fn(),
    purge: vi.fn(),
    restore: vi.fn(),
  },
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

/** A loaded page seeded straight into the view (no network needed). */
const view = (items: TrashItem[]): TrashListData => ({
  currentPage: 0,
  hasMore: false,
  items,
  nextCursor: null,
  pageSize: items.length,
  pages: [{ count: items.length, next: null }],
});

const seed = (items: TrashItem[], activeType?: TrashItem['resourceType']) =>
  useTrashStore.setState({
    ...initialState,
    activeType,
    trashCountReplica: createReplicaState(),
    trashListMap: { [trashListKey(activeType)]: view(items) },
    trashListReplica: createReplicaState(),
  });

const ids = () =>
  useTrashStore.getState().trashListMap[trashListKey()]?.items.map((i) => i.id) ?? [];

describe('TrashAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mutate).mockResolvedValue(undefined as never);
    vi.mocked(trashService.countByType).mockResolvedValue({});
    seed([buildItem(), buildItem({ id: 'trash_2', resourceId: 'tpc_2' })]);
  });

  describe('restore', () => {
    it('drops restored rows, keeps blocked ones, and revalidates the lists a restore touches', async () => {
      vi.mocked(trashService.restore).mockResolvedValue({
        failed: [{ code: 'parentTrashed', id: 'trash_2' }],
        restored: [buildItem()],
      });

      const outcome = await useTrashStore.getState().restore(['trash_1', 'trash_2']);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: 'trash_2' }]);
      expect(ids()).toEqual(['trash_2']);
      expect(useTrashStore.getState().loadingIds).toEqual([]);

      const predicates = vi
        .mocked(mutate)
        .mock.calls.map(([key]) => key as (k: unknown) => boolean);
      // The list + the counts revalidate for the active identity.
      expect(
        predicates.some((p) => p(['replica:sync', 'trashList', 1, 'u1:personal', 'all', {}])),
      ).toBe(true);
      expect(
        predicates.some((p) => p(['replica:sync', 'trashCount', 1, 'u1:personal', 'all', {}])),
      ).toBe(true);
      // …plus a filter-based sweep of the namespaces a restore can repopulate.
      const restored = predicates.find((p) => p(['topic:list', 'x', {}]) === true)!;
      expect(restored).toBeTruthy();
      expect(restored(['agent:list', true])).toBe(true);
      expect(restored(['replica:sync', 'topicList', 1, 'scope', 'agent_x', {}])).toBe(true);
      expect(restored(['agentSync:list', true, 'scope'])).toBe(true);
      expect(restored(['message:list', { agentId: 'a', topicId: 't' }, 1])).toBe(true);
      expect(restored(['trash:list', 'all'])).toBe(false);
      expect(restored('not-an-array')).toBe(false);
    });

    it('also drops rows the server reported as already gone', async () => {
      vi.mocked(trashService.restore).mockResolvedValue({
        failed: [{ code: 'notFound', id: 'trash_1' }],
        restored: [],
      });
      await useTrashStore.getState().restore(['trash_1']);
      expect(ids()).toEqual(['trash_2']);
      // Nothing came back — the trash list/counts refresh, but no cross-store sweep.
      const predicates = vi
        .mocked(mutate)
        .mock.calls.map(([key]) => key as (k: unknown) => boolean);
      expect(
        predicates.some((p) => p(['replica:sync', 'trashList', 1, 'u1:personal', 'all', {}])),
      ).toBe(true);
      expect(predicates.some((p) => p(['topic:list', 'x', {}]))).toBe(false);
    });

    it('marks rows as loading while the call is in flight', async () => {
      let resolve!: () => void;
      vi.mocked(trashService.restore).mockReturnValue(
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
    it('purge removes the rows from the active view', async () => {
      vi.mocked(trashService.purge).mockResolvedValue({ purged: 1 });
      await useTrashStore.getState().purge(['trash_1']);
      expect(trashService.purge).toHaveBeenCalledWith(['trash_1']);
      expect(ids()).toEqual(['trash_2']);
    });

    it('emptyTrash honours the active type filter and clears the list', async () => {
      vi.mocked(trashService.emptyTrash).mockResolvedValue({ hasMore: false, purged: 2 });
      seed([buildItem({ id: 'topic_only', resourceType: 'topic' })], 'topic');
      await useTrashStore.getState().emptyTrash();
      expect(trashService.emptyTrash).toHaveBeenCalledWith('topic');
      expect(useTrashStore.getState().trashListMap[trashListKey('topic')]?.items).toEqual([]);
    });

    it('emptyTrash keeps calling while the server reports more batches', async () => {
      vi.mocked(trashService.emptyTrash)
        .mockResolvedValueOnce({ hasMore: true, purged: 50 })
        .mockResolvedValueOnce({ hasMore: true, purged: 50 })
        .mockResolvedValueOnce({ hasMore: false, purged: 7 });
      await useTrashStore.getState().emptyTrash();
      expect(trashService.emptyTrash).toHaveBeenCalledTimes(3);
      expect(ids()).toEqual([]);
    });
  });

  describe('filter / refresh', () => {
    it('setActiveType switches the active filter without dropping loaded views', () => {
      useTrashStore.getState().setActiveType('agent');
      expect(useTrashStore.getState().activeType).toBe('agent');
      // The previous filter's page is still there — switching back is instant.
      expect(ids()).toEqual(['trash_1', 'trash_2']);
    });

    it('refresh revalidates the list(s) and the counts', async () => {
      await useTrashStore.getState().refresh();
      const predicates = vi
        .mocked(mutate)
        .mock.calls.map(([key]) => key as (k: unknown) => boolean);
      expect(
        predicates.some((p) => p(['replica:sync', 'trashList', 1, 'u1:personal', 'all', {}])),
      ).toBe(true);
      expect(
        predicates.some((p) => p(['replica:sync', 'trashCount', 1, 'u1:personal', 'all', {}])),
      ).toBe(true);
    });
  });
});
