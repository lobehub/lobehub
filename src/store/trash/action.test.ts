import type { ResourceTrashItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trashService } from '@/services/trash';

import { mutateTrash, useTrashDataSWR } from './hooks';
import { trashBucketKey, trashScopeKey } from './keys';
import { trashSelectors } from './selectors';
import { useTrashStore } from './store';

vi.mock('./hooks', () => ({
  mutateTrash: vi.fn(),
  useTrashDataSWR: vi.fn(),
}));

const buildItem = (overrides: Partial<ResourceTrashItem> = {}): ResourceTrashItem => ({
  deletedAt: new Date('2026-08-01T00:00:00Z'),
  deletedByUserId: 'u1',
  expiresAt: new Date('2026-08-31T00:00:00Z'),
  id: 'trash_1',
  meta: null,
  resourceId: 'file_1',
  resourceType: 'file',
  rootId: null,
  title: 'A file',
  userId: 'u1',
  workspaceId: null,
  ...overrides,
});

const personalContext = { scopeId: null };
const personalBucketKey = trashBucketKey(null);
const getPersonalItems = () => useTrashStore.getState().listByBucket[personalBucketKey]!.items;

describe('TrashAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mutateTrash).mockResolvedValue(undefined as never);
    useTrashStore.setState({
      countByScope: { [trashScopeKey(null)]: { document: 1, file: 2 } },
      listByBucket: {
        [personalBucketKey]: {
          isTrashInit: true,
          items: [buildItem(), buildItem({ id: 'trash_2', resourceId: 'file_2' })],
          nextCursor: null,
        },
      },
      loadingIds: [],
    });
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

      const outcome = await useTrashStore
        .getState()
        .restore(['trash_1', 'trash_2'], personalContext);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: 'trash_2' }]);
      expect(getPersonalItems().map((i) => i.id)).toEqual(['trash_2']);
      expect(useTrashStore.getState().loadingIds).toEqual([]);
      // recycle-bin list + counts, plus a filter-based sweep of the affected namespaces
      expect(mutateTrash).toHaveBeenCalledWith(expect.any(Function));
      expect(mutateTrash).toHaveBeenCalledWith(['trash:countByType', 'personal']);
      const filterCall = vi
        .mocked(mutateTrash)
        .mock.calls.find(
          ([key]) =>
            typeof key === 'function' && (key as (key: unknown) => boolean)(['file:list', 'x']),
        );
      expect(filterCall).toBeTruthy();
      const filter = filterCall![0] as (key: unknown) => boolean;
      expect(filter(['file:list', 'x', {}])).toBe(true);
      expect(filter(['document:list', true])).toBe(true);
      expect(filter(['agent:document:list', 'agent-1'])).toBe(true);
      expect(filter(['topic:list', 'x', {}])).toBe(false);
      expect(filter(['agent:list', true])).toBe(false);
      expect(filter(['trash:list', 'all'])).toBe(false);
      expect(filter('not-an-array')).toBe(false);
    });

    it('also drops rows the server reported as already gone', async () => {
      vi.spyOn(trashService, 'restore').mockResolvedValue({
        failed: [{ code: 'notFound', id: 'trash_1' }],
        restored: [],
      });
      await useTrashStore.getState().restore(['trash_1'], personalContext);
      expect(getPersonalItems().map((i) => i.id)).toEqual(['trash_2']);
      // Nothing came back — only Trash itself is refreshed, with no restored-resource sweep.
      const predicates = vi
        .mocked(mutateTrash)
        .mock.calls.filter(([key]) => typeof key === 'function')
        .map(([key]) => key as (key: unknown) => boolean);
      expect(predicates).toHaveLength(1);
      expect(predicates[0](['file:list', 'x'])).toBe(false);
    });

    it('marks rows as loading while the call is in flight', async () => {
      let resolve!: () => void;
      vi.spyOn(trashService, 'restore').mockReturnValue(
        new Promise((r) => {
          resolve = () => r({ failed: [], restored: [] });
        }),
      );
      const pending = useTrashStore.getState().restore(['trash_1'], personalContext);
      expect(trashSelectors.isLoading('trash_1')(useTrashStore.getState())).toBe(true);
      resolve();
      await pending;
      expect(trashSelectors.isLoading('trash_1')(useTrashStore.getState())).toBe(false);
    });
  });

  describe('purge / emptyTrash', () => {
    it('purge removes the rows locally and refreshes the bin', async () => {
      vi.spyOn(trashService, 'purge').mockResolvedValue({
        failed: [],
        purged: 1,
        purgedIds: ['trash_1'],
      });
      await useTrashStore.getState().purge(['trash_1'], personalContext);
      expect(trashService.purge).toHaveBeenCalledWith(['trash_1']);
      expect(getPersonalItems().map((i) => i.id)).toEqual(['trash_2']);
    });

    it('preserves a successful purge outcome when follow-up refresh fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(trashService, 'purge').mockResolvedValue({
        failed: [],
        purged: 1,
        purgedIds: ['trash_1'],
      });
      vi.mocked(mutateTrash).mockRejectedValue(new Error('refresh unavailable'));

      await expect(
        useTrashStore.getState().purge(['trash_1'], personalContext),
      ).resolves.toMatchObject({
        purged: 1,
      });
      expect(getPersonalItems().map((item) => item.id)).toEqual(['trash_2']);
      expect(useTrashStore.getState().loadingIds).toEqual([]);
      expect(consoleError).toHaveBeenCalledWith('[trash:refresh]', expect.any(Error));
    });

    it('emptyTrash honours the active type filter and clears the list', async () => {
      vi.spyOn(trashService, 'emptyTrash').mockResolvedValue({ scheduled: 2 });
      const context = { resourceType: 'file' as const, scopeId: null };
      const bucketKey = trashBucketKey(null, 'file');
      useTrashStore.setState({
        listByBucket: {
          ...useTrashStore.getState().listByBucket,
          [bucketKey]: {
            isTrashInit: true,
            items: [...getPersonalItems()],
            nextCursor: null,
          },
        },
      });
      await expect(useTrashStore.getState().emptyTrash(context)).resolves.toEqual({ scheduled: 2 });
      expect(trashService.emptyTrash).toHaveBeenCalledWith('file');
      expect(useTrashStore.getState().listByBucket[bucketKey]!.items).toEqual([]);
      expect(mutateTrash).toHaveBeenCalledWith(expect.any(Function));
    });

    it('keeps the local list truthful when emptyTrash scheduling fails', async () => {
      vi.spyOn(trashService, 'emptyTrash').mockRejectedValue(new Error('queue unavailable'));

      await expect(useTrashStore.getState().emptyTrash(personalContext)).rejects.toThrow(
        'queue unavailable',
      );

      expect(getPersonalItems().map((item) => item.id)).toEqual(['trash_1', 'trash_2']);
      expect(useTrashStore.getState().loadingIds).toEqual([]);
    });
  });

  describe('paging / filter', () => {
    it('loadMore appends the next page', async () => {
      useTrashStore.setState({
        listByBucket: {
          ...useTrashStore.getState().listByBucket,
          [personalBucketKey]: {
            ...useTrashStore.getState().listByBucket[personalBucketKey]!,
            nextCursor: 'cursor-1',
          },
        },
      });
      vi.spyOn(trashService, 'list').mockResolvedValue({
        items: [buildItem({ id: 'trash_3', resourceId: 'file_3' })],
        nextCursor: null,
      });
      await useTrashStore.getState().loadMore(personalContext);
      expect(trashService.list).toHaveBeenCalledWith({
        cursor: 'cursor-1',
        resourceType: undefined,
      });
      expect(getPersonalItems().map((i) => i.id)).toEqual(['trash_1', 'trash_2', 'trash_3']);
      expect(useTrashStore.getState().listByBucket[personalBucketKey]!.nextCursor).toBeNull();
    });

    it('keeps simultaneously mounted workspace, filter, and count consumers independent', async () => {
      const action = useTrashStore.getState();
      action.useFetchTrash(true, undefined, 'workspace-a');
      const workspaceAListSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;
      action.useFetchTrash(true, 'file', 'workspace-b');
      const workspaceBListSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;
      action.useFetchTrashCount(true, 'workspace-a');
      const workspaceACountSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;
      action.useFetchTrashCount(true, 'workspace-b');
      const workspaceBCountSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;

      workspaceAListSuccess?.(
        {
          items: [buildItem({ id: 'trash_a', title: 'Workspace A' })],
          nextCursor: 'cursor-a',
        },
        '',
        undefined as never,
      );
      workspaceBListSuccess?.(
        {
          items: [buildItem({ id: 'trash_b', title: 'Workspace B', workspaceId: 'workspace-b' })],
          nextCursor: null,
        },
        '',
        undefined as never,
      );
      workspaceACountSuccess?.({ document: 1 }, '', undefined as never);
      workspaceBCountSuccess?.({ file: 1 }, '', undefined as never);

      vi.spyOn(trashService, 'list').mockResolvedValue({
        items: [buildItem({ id: 'trash_a_2', title: 'Workspace A page 2' })],
        nextCursor: null,
      });
      await action.loadMore({ scopeId: 'workspace-a' });

      vi.spyOn(trashService, 'restore').mockResolvedValue({
        failed: [],
        restored: [buildItem({ id: 'trash_a' })],
      });
      await action.restore(['trash_a'], { scopeId: 'workspace-a' });

      expect(useTrashStore.getState().listByBucket[trashBucketKey('workspace-a')]!.items).toEqual([
        expect.objectContaining({ title: 'Workspace A page 2' }),
      ]);
      expect(
        useTrashStore.getState().listByBucket[trashBucketKey('workspace-b', 'file')]!.items,
      ).toEqual([expect.objectContaining({ title: 'Workspace B' })]);
      expect(useTrashStore.getState().countByScope).toMatchObject({
        'workspace-a': { document: 1 },
        'workspace-b': { file: 1 },
      });
      expect(vi.mocked(useTrashDataSWR).mock.calls.map(([key]) => key)).toEqual([
        ['trash:list', 'workspace-a', 'all'],
        ['trash:list', 'workspace-b', 'file'],
        ['trash:countByType', 'workspace-a'],
        ['trash:countByType', 'workspace-b'],
      ]);
    });

    it('keeps separate first pages for multiple filters in the same workspace', () => {
      const action = useTrashStore.getState();
      action.useFetchTrash(true, undefined, 'workspace-a');
      const allSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;
      action.useFetchTrash(true, 'file', 'workspace-a');
      const fileSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;

      allSuccess?.(
        { items: [buildItem({ resourceType: 'document' })], nextCursor: null },
        '',
        undefined as never,
      );
      fileSuccess?.(
        { items: [buildItem({ title: 'Current files' })], nextCursor: null },
        '',
        undefined as never,
      );
      expect(useTrashStore.getState().listByBucket[trashBucketKey('workspace-a')]!.items).toEqual([
        expect.objectContaining({ resourceType: 'document' }),
      ]);
      expect(
        useTrashStore.getState().listByBucket[trashBucketKey('workspace-a', 'file')]!.items,
      ).toEqual([expect.objectContaining({ title: 'Current files' })]);
    });

    it('ignores a stale next page after its own bucket receives a newer first page', async () => {
      const action = useTrashStore.getState();
      action.useFetchTrash(true, undefined, 'workspace-a');
      const firstPageSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;
      const bucketKey = trashBucketKey('workspace-a');
      useTrashStore.setState({
        listByBucket: {
          ...useTrashStore.getState().listByBucket,
          [bucketKey]: {
            isTrashInit: true,
            items: [buildItem({ title: 'Workspace A', workspaceId: 'workspace-a' })],
            nextCursor: 'workspace-a-cursor',
          },
        },
      });
      let resolvePage!: (page: { items: ResourceTrashItem[]; nextCursor: string | null }) => void;
      vi.spyOn(trashService, 'list').mockReturnValue(
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
      );

      const pending = action.loadMore({ scopeId: 'workspace-a' });
      firstPageSuccess?.(
        {
          items: [buildItem({ title: 'New Workspace A' })],
          nextCursor: null,
        },
        '',
        undefined as never,
      );
      resolvePage({
        items: [buildItem({ id: 'trash_a_2', title: 'Late Workspace A' })],
        nextCursor: null,
      });
      await pending;

      expect(useTrashStore.getState().listByBucket[bucketKey]).toMatchObject({
        items: [expect.objectContaining({ title: 'New Workspace A' })],
        nextCursor: null,
      });
    });
  });

  describe('selectors', () => {
    it('totalCount sums the per-type counts', () => {
      expect(trashSelectors.totalCount(null)(useTrashStore.getState())).toBe(3);
    });
  });
});
