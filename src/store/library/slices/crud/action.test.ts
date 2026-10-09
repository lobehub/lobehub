/**
 * @vitest-environment happy-dom
 *
 * The knowledge-base list and the by-id projection are replicas: they paint
 * from the persisted copy on the first frame, the network only confirms, and a
 * rename or delete reaches every loaded copy at once.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import type { KnowledgeBaseItem } from '@/types/knowledgeBase';

import { useKnowledgeBaseStore } from '../../store';
import { initialKnowledgeBaseState } from './initialState';
import { knowledgeBaseItemResource, knowledgeBaseListResource } from './projection';
import { knowledgeBaseSelectors } from './selectors';

const mocks = vi.hoisted(() => ({ activeWorkspaceId: null as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => mocks.activeWorkspaceId,
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/services/knowledgeBase', () => ({
  knowledgeBaseService: {
    createKnowledgeBase: vi.fn(),
    deleteKnowledgeBase: vi.fn(),
    getKnowledgeBaseById: vi.fn(),
    getKnowledgeBaseList: vi.fn(),
    publishKnowledgeBaseToWorkspace: vi.fn(),
    setKnowledgeBaseVisibility: vi.fn(),
    updateKnowledgeBaseList: vi.fn(),
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

const item = (id: string, name = id): KnowledgeBaseItem =>
  ({
    avatar: null,
    createdAt: new Date(0),
    id,
    isPublic: null,
    name,
    settings: {},
    type: 'file',
    updatedAt: new Date(0),
  }) as KnowledgeBaseItem;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const list = (visibility?: 'private' | 'public') =>
  useKnowledgeBaseStore.getState().knowledgeBaseListMap[visibility ?? 'all'];

const detail = (id: string) =>
  knowledgeBaseSelectors.getKnowledgeBaseById(id)(useKnowledgeBaseStore.getState());

const LIST_ALL_STORAGE_KEY = knowledgeBaseListResource.storageKey({ visibility: undefined });
const LIST_PRIVATE_STORAGE_KEY = knowledgeBaseListResource.storageKey({ visibility: 'private' });
const listStorageKeys = [LIST_ALL_STORAGE_KEY, LIST_PRIVATE_STORAGE_KEY, 'public'];
const itemStorageKeys = ['kb-1', 'kb-9', 'p1', 'kb-gone'];

describe('knowledgeBase crud replicas', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    mocks.activeWorkspaceId = null;
    useScope(`kb-user-${randomUUID()}:personal`);
    act(() => useKnowledgeBaseStore.setState(initialKnowledgeBaseState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((scope) => [
        ...listStorageKeys.map((queryKey) =>
          knowledgeBaseListResource.storage!.remove({ queryKey, scope }),
        ),
        ...itemStorageKeys.map((queryKey) =>
          knowledgeBaseItemResource.storage!.remove({ queryKey, scope }),
        ),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('reads', () => {
    it('paints the persisted list before the network answers', async () => {
      await knowledgeBaseListResource.storage!.set(
        { queryKey: LIST_PRIVATE_STORAGE_KEY, scope },
        { data: [item('kb-1', 'Cached')], updatedAt: 1 },
      );
      vi.mocked(knowledgeBaseService.getKnowledgeBaseList).mockImplementation(pending);

      const sync = renderHook(
        () => useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList)('private'),
        { wrapper },
      );
      const view = renderHook(() =>
        useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseList('private')),
      );

      await waitFor(() => expect(view.result.current?.map((kb) => kb.name)).toEqual(['Cached']));
      expect(sync.result.current.isHydrated).toBe(true);
      expect(sync.result.current.isValidating).toBe(true);
    });

    it('replaces the list with the server response and persists it', async () => {
      vi.mocked(knowledgeBaseService.getKnowledgeBaseList).mockResolvedValue([
        item('kb-1', 'Server'),
      ] as any);

      renderHook(() => useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList)('private'), {
        wrapper,
      });

      await waitFor(() => expect(list('private')?.[0]?.name).toBe('Server'));
      await waitFor(async () => {
        const cached = await knowledgeBaseListResource.storage!.get({
          queryKey: LIST_PRIVATE_STORAGE_KEY,
          scope,
        });
        expect(cached?.data.map((kb) => kb.id)).toEqual(['kb-1']);
      });
    });

    it('keeps the private and workspace surfaces apart', async () => {
      vi.mocked(knowledgeBaseService.getKnowledgeBaseList).mockImplementation(
        async (visibility?: 'private' | 'public') =>
          (visibility === 'private' ? [item('p1', 'Private')] : [item('w1', 'Workspace')]) as any,
      );

      renderHook(() => useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList)('private'), {
        wrapper,
      });
      renderHook(() => useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList)('public'), {
        wrapper,
      });

      await waitFor(() => expect(list('private')).toHaveLength(1));
      await waitFor(() => expect(list('public')).toHaveLength(1));
      expect(list('private')![0].name).toBe('Private');
      expect(list('public')![0].name).toBe('Workspace');
    });

    it('lands a KB fetched by id in the by-id projection', async () => {
      vi.mocked(knowledgeBaseService.getKnowledgeBaseById).mockResolvedValue(
        item('kb-9', 'Detail') as any,
      );

      renderHook(() => useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseItem)('kb-9'), {
        wrapper,
      });

      await waitFor(() => expect(detail('kb-9')?.name).toBe('Detail'));
      expect(
        knowledgeBaseSelectors.getKnowledgeBaseNameById('kb-9')(useKnowledgeBaseStore.getState()),
      ).toBe('Detail');
      expect(useKnowledgeBaseStore.getState().activeKnowledgeBaseId).toBe('kb-9');
    });

    it('drops the cached by-id detail when the server reports it missing', async () => {
      // A detail persisted by an earlier session (or another tab).
      await knowledgeBaseItemResource.storage!.set(
        { queryKey: 'kb-gone', scope },
        { data: item('kb-gone', 'Cached') as any, updatedAt: 1 },
      );

      // The record was deleted elsewhere: the by-id fetch confirms the miss.
      vi.mocked(knowledgeBaseService.getKnowledgeBaseById).mockResolvedValue(undefined as any);

      renderHook(() => useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseItem)('kb-gone'), {
        wrapper,
      });

      // The stale cached row must not keep the route on a resolved detail.
      await waitFor(() => expect(detail('kb-gone')).toBeUndefined());
      expect(knowledgeBaseService.getKnowledgeBaseById).toHaveBeenCalledWith('kb-gone');
    });
  });

  describe('mutations', () => {
    /** Load `private` (and `all`) with two rows so the write paths have a target. */
    const seedList = async (items: KnowledgeBaseItem[] = [item('p1', 'Original'), item('p2')]) => {
      vi.mocked(knowledgeBaseService.getKnowledgeBaseList).mockResolvedValue(items as any);
      renderHook(() => useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList)('private'), {
        wrapper,
      });
      await waitFor(() => expect(list('private')).toHaveLength(items.length));
    };

    it('removes a KB optimistically and rolls the row back when the delete fails', async () => {
      await seedList();

      let reject!: (error: unknown) => void;
      vi.mocked(knowledgeBaseService.deleteKnowledgeBase).mockImplementation(
        () => new Promise((_resolve, rej) => (reject = rej)) as any,
      );

      const operation = useKnowledgeBaseStore.getState().removeKnowledgeBase('p1');

      await waitFor(() => expect(list('private')?.map((kb) => kb.id)).toEqual(['p2']));

      reject(new Error('boom'));
      await expect(operation).rejects.toThrow('boom');

      expect(list('private')?.map((kb) => kb.id)).toEqual(['p1', 'p2']);
    });

    it('renames across the list and the by-id copy optimistically, then reconciles', async () => {
      await seedList();
      vi.mocked(knowledgeBaseService.getKnowledgeBaseById).mockResolvedValue(item('p1') as any);
      renderHook(() => useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseItem)('p1'), {
        wrapper,
      });
      await waitFor(() => expect(detail('p1')).toBeDefined());

      let resolve!: (value: unknown) => void;
      vi.mocked(knowledgeBaseService.updateKnowledgeBaseList).mockImplementation(
        () => new Promise((res) => (resolve = res)) as any,
      );

      const operation = useKnowledgeBaseStore.getState().updateKnowledgeBase('p1', {
        name: 'Renamed',
      });

      // Both loaded copies show the new name before the server answers.
      expect(list('private')?.find((kb) => kb.id === 'p1')?.name).toBe('Renamed');
      expect(detail('p1')?.name).toBe('Renamed');
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toContain('p1');

      // The refresh that follows the write sees the server's new state.
      vi.mocked(knowledgeBaseService.getKnowledgeBaseList).mockResolvedValue([
        item('p1', 'Renamed'),
        item('p2'),
      ] as any);
      await act(async () => {
        resolve(undefined);
        await operation;
      });

      expect(list('private')?.find((kb) => kb.id === 'p1')?.name).toBe('Renamed');
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).not.toContain('p1');
    });

    it('rolls the rename back and clears the loading flag when the write fails', async () => {
      await seedList();
      vi.mocked(knowledgeBaseService.updateKnowledgeBaseList).mockRejectedValue(new Error('boom'));

      await expect(
        useKnowledgeBaseStore.getState().updateKnowledgeBase('p1', { name: 'Renamed' }),
      ).rejects.toThrow('boom');

      expect(list('private')?.find((kb) => kb.id === 'p1')?.name).toBe('Original');
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).not.toContain('p1');
    });

    it('creates a KB and reconciles the list from the server', async () => {
      await seedList();
      vi.mocked(knowledgeBaseService.createKnowledgeBase).mockResolvedValue('kb-new' as any);
      vi.mocked(knowledgeBaseService.getKnowledgeBaseList).mockResolvedValue([
        item('kb-new', 'Fresh'),
        item('p1', 'Original'),
        item('p2'),
      ] as any);

      const id = await act(() =>
        useKnowledgeBaseStore.getState().createNewKnowledgeBase({ name: 'Fresh' }),
      );

      expect(id).toBe('kb-new');
      expect(knowledgeBaseService.createKnowledgeBase).toHaveBeenCalledWith({ name: 'Fresh' });
      await waitFor(() => expect(list('private')?.[0]?.id).toBe('kb-new'));
    });

    it('publishes and flips visibility through the server, then refreshes', async () => {
      await seedList();
      vi.mocked(knowledgeBaseService.publishKnowledgeBaseToWorkspace).mockResolvedValue(
        undefined as any,
      );
      vi.mocked(knowledgeBaseService.setKnowledgeBaseVisibility).mockResolvedValue(
        undefined as any,
      );

      await act(() => useKnowledgeBaseStore.getState().publishKnowledgeBaseToWorkspace('p1'));
      await act(() => useKnowledgeBaseStore.getState().setKnowledgeBaseVisibility('p1', 'private'));

      expect(knowledgeBaseService.publishKnowledgeBaseToWorkspace).toHaveBeenCalledWith('p1');
      expect(knowledgeBaseService.setKnowledgeBaseVisibility).toHaveBeenCalledWith('p1', 'private');
    });

    it('toggles the row loading flag', () => {
      act(() => useKnowledgeBaseStore.getState().internal_toggleKnowledgeBaseLoading('p1', true));
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).toContain('p1');

      act(() => useKnowledgeBaseStore.getState().internal_toggleKnowledgeBaseLoading('p1', false));
      expect(useKnowledgeBaseStore.getState().knowledgeBaseLoadingIds).not.toContain('p1');
    });
  });
});
