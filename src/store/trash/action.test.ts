import type { TrashItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trashService } from '@/services/trash';

import { mutateTrash, useTrashDataSWR } from './hooks';
import { trashSelectors } from './selectors';
import { useTrashStore } from './store';

vi.mock('./hooks', () => ({
  mutateTrash: vi.fn(),
  useTrashDataSWR: vi.fn(),
}));

const buildItem = (overrides: Partial<TrashItem> = {}): TrashItem => ({
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

describe('TrashAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const action = useTrashStore.getState();
    action.setActiveType(undefined);
    action.useFetchTrash(false, undefined, null);
    vi.clearAllMocks();
    vi.mocked(mutateTrash).mockResolvedValue(undefined as never);
    useTrashStore.setState({
      activeType: undefined,
      countByType: { document: 1, file: 2 },
      countScopeId: null,
      isTrashInit: true,
      items: [buildItem(), buildItem({ id: 'trash_2', resourceId: 'file_2' })],
      itemsScopeId: null,
      loadingIds: [],
      nextCursor: null,
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

      const outcome = await useTrashStore.getState().restore(['trash_1', 'trash_2']);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: 'trash_2' }]);
      expect(useTrashStore.getState().items.map((i) => i.id)).toEqual(['trash_2']);
      expect(useTrashStore.getState().loadingIds).toEqual([]);
      // recycle-bin list + counts, plus a filter-based sweep of the affected namespaces
      expect(mutateTrash).toHaveBeenCalledWith(['trash:list', 'personal', 'all']);
      expect(mutateTrash).toHaveBeenCalledWith(['trash:countByType', 'personal']);
      const filterCall = vi
        .mocked(mutateTrash)
        .mock.calls.find(([key]) => typeof key === 'function');
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
      await useTrashStore.getState().restore(['trash_1']);
      expect(useTrashStore.getState().items.map((i) => i.id)).toEqual(['trash_2']);
      // nothing came back — no cross-store revalidation
      expect(vi.mocked(mutateTrash).mock.calls.some(([key]) => typeof key === 'function')).toBe(
        false,
      );
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
      vi.spyOn(trashService, 'purge').mockResolvedValue({
        failed: [],
        purged: 1,
        purgedIds: ['trash_1'],
      });
      await useTrashStore.getState().purge(['trash_1']);
      expect(trashService.purge).toHaveBeenCalledWith(['trash_1']);
      expect(useTrashStore.getState().items.map((i) => i.id)).toEqual(['trash_2']);
    });

    it('preserves a successful purge outcome when follow-up refresh fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(trashService, 'purge').mockResolvedValue({
        failed: [],
        purged: 1,
        purgedIds: ['trash_1'],
      });
      vi.mocked(mutateTrash).mockRejectedValue(new Error('refresh unavailable'));

      await expect(useTrashStore.getState().purge(['trash_1'])).resolves.toMatchObject({
        purged: 1,
      });
      expect(useTrashStore.getState().items.map((item) => item.id)).toEqual(['trash_2']);
      expect(useTrashStore.getState().loadingIds).toEqual([]);
      expect(consoleError).toHaveBeenCalledWith('[trash:refresh]', expect.any(Error));
    });

    it('emptyTrash honours the active type filter and clears the list', async () => {
      vi.spyOn(trashService, 'emptyTrash').mockResolvedValue({ scheduled: 2 });
      useTrashStore.setState({ activeType: 'file' });
      await expect(useTrashStore.getState().emptyTrash()).resolves.toEqual({ scheduled: 2 });
      expect(trashService.emptyTrash).toHaveBeenCalledWith('file');
      expect(useTrashStore.getState().items).toEqual([]);
      expect(mutateTrash).toHaveBeenCalledWith(['trash:list', 'personal', 'file']);
    });

    it('keeps the local list truthful when emptyTrash scheduling fails', async () => {
      vi.spyOn(trashService, 'emptyTrash').mockRejectedValue(new Error('queue unavailable'));

      await expect(useTrashStore.getState().emptyTrash()).rejects.toThrow('queue unavailable');

      expect(useTrashStore.getState().items.map((item) => item.id)).toEqual(['trash_1', 'trash_2']);
      expect(useTrashStore.getState().loadingIds).toEqual([]);
    });
  });

  describe('paging / filter', () => {
    it('setActiveType resets the list so the new filter starts from a fresh first page', () => {
      useTrashStore.setState({ nextCursor: 'abc' });
      useTrashStore.getState().setActiveType('knowledgeBase');
      expect(useTrashStore.getState()).toMatchObject({
        activeType: 'knowledgeBase',
        isTrashInit: false,
        items: [],
        nextCursor: null,
      });
    });

    it('loadMore appends the next page', async () => {
      useTrashStore.setState({ nextCursor: 'cursor-1' });
      vi.spyOn(trashService, 'list').mockResolvedValue({
        items: [buildItem({ id: 'trash_3', resourceId: 'file_3' })],
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

    it('keys data by workspace and ignores a stale response from the previous scope', () => {
      const action = useTrashStore.getState();
      action.useFetchTrash(true, undefined, 'workspace-a');
      const firstSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;
      action.useFetchTrash(true, undefined, 'workspace-b');
      const secondSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;

      firstSuccess?.(
        { items: [buildItem({ title: 'Workspace A' })], nextCursor: null },
        '',
        undefined as never,
      );
      expect(useTrashStore.getState().itemsScopeId).toBeNull();

      secondSuccess?.(
        {
          items: [buildItem({ title: 'Workspace B', workspaceId: 'workspace-b' })],
          nextCursor: null,
        },
        '',
        undefined as never,
      );
      expect(useTrashStore.getState()).toMatchObject({
        items: [expect.objectContaining({ title: 'Workspace B' })],
        itemsScopeId: 'workspace-b',
      });
      expect(vi.mocked(useTrashDataSWR).mock.calls.map(([key]) => key)).toEqual([
        ['trash:list', 'workspace-a', 'all'],
        ['trash:list', 'workspace-b', 'all'],
      ]);
    });

    it('ignores a stale first page from the previous resource type', () => {
      const action = useTrashStore.getState();
      action.setActiveType(undefined);
      action.useFetchTrash(true, undefined, 'workspace-a');
      const allSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;

      action.setActiveType('file');
      action.useFetchTrash(true, 'file', 'workspace-a');
      const fileSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;

      allSuccess?.(
        { items: [buildItem({ resourceType: 'document' })], nextCursor: null },
        '',
        undefined as never,
      );
      expect(useTrashStore.getState().items).toEqual([]);

      fileSuccess?.(
        { items: [buildItem({ title: 'Current files' })], nextCursor: null },
        '',
        undefined as never,
      );
      expect(useTrashStore.getState().items).toEqual([
        expect.objectContaining({ title: 'Current files' }),
      ]);
    });

    it('ignores a stale next page after switching workspaces', async () => {
      const action = useTrashStore.getState();
      action.useFetchTrash(true, undefined, 'workspace-a');
      useTrashStore.setState({
        items: [buildItem({ title: 'Workspace A', workspaceId: 'workspace-a' })],
        itemsScopeId: 'workspace-a',
        nextCursor: 'workspace-a-cursor',
      });
      let resolvePage!: (page: { items: TrashItem[]; nextCursor: string | null }) => void;
      vi.spyOn(trashService, 'list').mockReturnValue(
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
      );

      const pending = action.loadMore();
      action.useFetchTrash(true, undefined, 'workspace-b');
      const workspaceBSuccess = vi.mocked(useTrashDataSWR).mock.calls.at(-1)?.[2]?.onSuccess;
      workspaceBSuccess?.(
        {
          items: [buildItem({ title: 'Workspace B', workspaceId: 'workspace-b' })],
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

      expect(useTrashStore.getState()).toMatchObject({
        items: [expect.objectContaining({ title: 'Workspace B' })],
        itemsScopeId: 'workspace-b',
        nextCursor: null,
      });
    });
  });

  describe('selectors', () => {
    it('totalCount sums the per-type counts', () => {
      expect(trashSelectors.totalCount(useTrashStore.getState())).toBe(3);
    });
  });
});
