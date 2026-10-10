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

import { cacheScope, createReplicaState } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { trashService, type TrashViewFilter } from '@/services/trash';

import { TrashEmptyScopeChangedError } from './action';
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

const seed = (items: TrashItem[], filter: TrashViewFilter = {}) =>
  useTrashStore.setState({
    ...initialState,
    activeType: filter.resourceType,
    trashCountReplica: createReplicaState(),
    trashListMap: { [trashListKey(filter)]: view(items) },
    trashListReplica: createReplicaState(),
  });

const ids = (filter: TrashViewFilter = {}) =>
  useTrashStore.getState().trashListMap[trashListKey(filter)]?.items.map((i) => i.id) ?? [];

const syncKey = (name: string, key: string) => ['replica:sync', name, 2, 'u1:personal', key, {}];

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
      expect(predicates.some((p) => p(syncKey('trashList', trashListKey())))).toBe(true);
      expect(predicates.some((p) => p(syncKey('trashCount', 'all')))).toBe(true);
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
      expect(predicates.some((p) => p(syncKey('trashList', trashListKey())))).toBe(true);
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

    it('emptyTrash sweeps the given view in the scope it started in and clears it', async () => {
      vi.mocked(trashService.emptyTrash).mockResolvedValue({ hasMore: false, purged: 2 });
      const filter = { projectId: 'proj_a', resourceType: 'topic' } as const;
      seed([buildItem({ id: 'topic_only', resourceType: 'topic' })], filter);
      await useTrashStore.getState().emptyTrash(filter);
      // `null`: the personal scope (no active workspace in the community build).
      expect(trashService.emptyTrash).toHaveBeenCalledWith(filter, null);
      expect(ids(filter)).toEqual([]);
    });

    it('emptyTrash keeps calling while the server reports more batches', async () => {
      vi.mocked(trashService.emptyTrash)
        .mockResolvedValueOnce({ hasMore: true, purged: 50 })
        .mockResolvedValueOnce({ hasMore: true, purged: 50 })
        .mockResolvedValueOnce({ hasMore: false, purged: 7 });
      await useTrashStore.getState().emptyTrash({});
      expect(trashService.emptyTrash).toHaveBeenCalledTimes(3);
      expect(ids()).toEqual([]);
    });

    it('emptyTrash keeps every batch on the view it started with when the view switches', async () => {
      const started = { projectId: 'proj_a' } as const;
      useTrashStore.setState({
        trashListMap: {
          [trashListKey(started)]: view([buildItem({ id: 'in_a' })]),
          // The same root also sits under "All"; an unrelated project's row stays.
          [trashListKey()]: view([buildItem({ id: 'in_a' }), buildItem({ id: 'in_b' })]),
          [trashListKey({ projectId: 'proj_b' })]: view([buildItem({ id: 'in_b' })]),
        },
      });
      vi.mocked(trashService.emptyTrash)
        .mockImplementationOnce(async () => {
          // The user switches to another project (and type) while batches run.
          useTrashStore
            .getState()
            .setFilter({ projectId: null, resourceType: 'agent' }, 'u1:personal');
          return { hasMore: true, purged: 50 };
        })
        .mockResolvedValueOnce({ hasMore: false, purged: 1 });

      await useTrashStore.getState().emptyTrash(started);

      expect(vi.mocked(trashService.emptyTrash).mock.calls).toEqual([
        [started, null],
        [started, null],
      ]);
      // No view keeps rows the sweep may have reached; each reloads when shown.
      expect(ids(started)).toEqual([]);
      expect(ids()).toEqual([]);
      expect(ids({ projectId: 'proj_b' })).toEqual([]);
    });

    it('drops the cached counts of other views after a write, and their rows after a sweep', async () => {
      const active = { projectId: 'proj_a' } as const;
      const other = { projectId: 'proj_b' } as const;
      useTrashStore.setState({
        projectSelection: { projectId: 'proj_a', scope: 'u1:personal' },
        trashCountMap: {
          'all': { topic: 9 },
          'project:proj_a': { topic: 1 },
          'project:proj_b': { topic: 4 },
        },
        trashListMap: {
          [trashListKey(active)]: view([buildItem({ id: 'in_a' })]),
          [trashListKey(other)]: view([buildItem({ id: 'in_b' })]),
        },
      });
      vi.mocked(trashService.purge).mockResolvedValue({ purged: 1 });

      await useTrashStore.getState().purge(['in_a']);
      // Other views' counts are unknown now (not stale numbers); their rows stay.
      expect(Object.keys(useTrashStore.getState().trashCountMap)).toEqual(['project:proj_a']);
      expect(ids(other)).toEqual(['in_b']);

      vi.mocked(trashService.emptyTrash).mockResolvedValue({ hasMore: false, purged: 1 });
      await useTrashStore.getState().emptyTrash(active);
      expect(Object.keys(useTrashStore.getState().trashListMap)).toEqual([trashListKey(active)]);
    });

    it('emptyTrash stops, without touching the new scope, when the scope switches mid-sweep', async () => {
      let scope = 'u1:personal';
      vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
      seed([buildItem()], { projectId: null });
      vi.mocked(trashService.emptyTrash).mockImplementationOnce(async () => {
        scope = 'u1:ws_2';
        return { hasMore: true, purged: 50 };
      });

      await expect(useTrashStore.getState().emptyTrash({ projectId: null })).rejects.toBeInstanceOf(
        TrashEmptyScopeChangedError,
      );
      expect(trashService.emptyTrash).toHaveBeenCalledTimes(1);
      expect(useTrashStore.getState().loadingIds).toEqual([]);
      vi.restoreAllMocks();
    });
  });

  describe('filter / refresh', () => {
    it('setFilter switches the view without dropping the other loaded views', () => {
      useTrashStore.getState().setFilter({ resourceType: 'agent' }, 'u1:personal');
      expect(useTrashStore.getState().activeType).toBe('agent');
      // The previous view's page is still there — switching back is instant.
      expect(ids()).toEqual(['trash_1', 'trash_2']);
    });

    it('setFilter restarts the view it switches to from its head page', () => {
      const project = { projectId: 'proj_a' } as const;
      useTrashStore.setState({
        trashListMap: {
          [trashListKey(project)]: {
            currentPage: 1,
            hasMore: false,
            items: [buildItem({ id: 'head' }), buildItem({ id: 'older' })],
            nextCursor: null,
            pageSize: 1,
            pages: [
              { count: 1, next: 'cursor-1' },
              { count: 1, next: null },
            ],
          },
        },
      });

      useTrashStore.getState().setFilter(project, 'u1:personal');

      const list = useTrashStore.getState().trashListMap[trashListKey(project)];
      expect(list?.items.map((item) => item.id)).toEqual(['head']);
      expect(list?.currentPage).toBe(0);
      expect(list?.nextCursor).toBe('cursor-1');
    });

    it('binds a project filter to the scope it was chosen in', () => {
      useTrashStore.getState().setFilter({ projectId: 'proj_a' }, 'u1:personal');
      const state = useTrashStore.getState();
      expect(trashSelectors.activeProjectId('u1:personal')(state)).toBe('proj_a');
      // Another workspace (or account) starts on every project, not on a foreign id.
      expect(trashSelectors.activeProjectId('u1:ws_2')(state)).toBeUndefined();

      useTrashStore.getState().setFilter({ projectId: null }, 'u1:personal');
      expect(trashSelectors.activeProjectId('u1:personal')(useTrashStore.getState())).toBeNull();
    });

    it('refresh revalidates the list(s) and the counts', async () => {
      await useTrashStore.getState().refresh();
      const predicates = vi
        .mocked(mutate)
        .mock.calls.map(([key]) => key as (k: unknown) => boolean);
      expect(predicates.some((p) => p(syncKey('trashList', trashListKey())))).toBe(true);
      expect(predicates.some((p) => p(syncKey('trashCount', 'all')))).toBe(true);
    });
  });
});
