/**
 * @vitest-environment happy-dom
 *
 * Work lists are replicas: the gallery, the project dashboard's latest works,
 * the sidebar history and the version timelines paint from their persisted
 * copy on the first frame, the network only confirms, and the `work:` sync
 * keys keep the existing Work refresh paths reaching them.
 */
import { randomUUID } from 'node:crypto';

import type { WorkListItem, WorkSummaryItem, WorkVersionItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { workService } from '@/services/work';

import { workActions } from './action';
import { initialWorkState, type WorkspaceWorksData } from './initialState';
import {
  agentWorksResource,
  conversationWorksKey,
  conversationWorksResource,
  workspaceWorksKey,
  type WorkspaceWorksParams,
  workspaceWorksResource,
  workVersionsResource,
} from './projection';
import { workSelectors } from './selectors';
import { useWorkStore } from './store';

vi.mock('@/services/work', async (importOriginal) => {
  const actual = await importOriginal<{ workService: typeof workService }>();
  const service = actual.workService;
  service.listByConversation = vi.fn();
  service.listByWorkspace = vi.fn();
  service.listVersions = vi.fn();
  return { ...actual, workService: service };
});

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

const summary = (id: string, title = id): WorkSummaryItem =>
  ({ id, resourceType: 'document', title, type: 'document' }) as unknown as WorkSummaryItem;

const listItem = (id: string, title = id): WorkListItem =>
  ({ id, resourceType: 'document', title, type: 'document' }) as unknown as WorkListItem;

const version = (id: string, content: string | null = null): WorkVersionItem =>
  ({ changeType: 'created', content, id, version: 1, workId: 'wk_1' }) as WorkVersionItem;

/** A persisted head page as the paged engine writes it. */
const paged = (items: WorkSummaryItem[], nextCursor: string | null = null): WorkspaceWorksData => ({
  currentPage: 0,
  hasMore: nextCursor !== null,
  items,
  nextCursor,
  pageSize: items.length,
  pages: [{ count: items.length, next: nextCursor }],
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const ALL: WorkspaceWorksParams = { workspaceId: null };

const galleryIds = (params = ALL) =>
  useWorkStore.getState().workspaceWorksMap[workspaceWorksKey(params)]?.items.map((i) => i.id);

describe('work replicas', () => {
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
    useScope(`work-user-${randomUUID()}:personal`);
    act(() => useWorkStore.setState({ ...initialWorkState }));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) => [
        workspaceWorksResource.storage!.remove({
          queryKey: workspaceWorksKey(ALL),
          scope: value,
        }),
        agentWorksResource.storage!.remove({ queryKey: 'agt_1', scope: value }),
        conversationWorksResource.storage!.remove({
          queryKey: conversationWorksKey({ topicId: 'tpc_1' }),
          scope: value,
        }),
        workVersionsResource.storage!.remove({ queryKey: 'wk_1', scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
  });

  it('paints the persisted gallery head page before the network answers', async () => {
    await workspaceWorksResource.storage!.set(
      { queryKey: workspaceWorksResource.storageKey(ALL), scope },
      { data: paged([summary('wk_1', 'Cached')]), updatedAt: 1 },
    );
    vi.mocked(workService.listByWorkspace).mockImplementation(pending);

    const sync = renderHook(() => workActions.useFetchWorkspaceWorks(ALL), { wrapper });
    const list = renderHook(() => useWorkStore(workSelectors.workspaceWorks(ALL)));

    await waitFor(() => expect(list.result.current?.items.map((i) => i.title)).toEqual(['Cached']));
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('pre-hydrates the gallery from storage without a mounted view', async () => {
    await workspaceWorksResource.storage!.set(
      { queryKey: workspaceWorksResource.storageKey(ALL), scope },
      { data: paged([summary('wk_1', 'Cached')]), updatedAt: 1 },
    );

    await workActions.preHydrateWorkspaceWorks(ALL);

    expect(galleryIds()).toEqual(['wk_1']);
    expect(workService.listByWorkspace).not.toHaveBeenCalled();
  });

  it('replaces the gallery with the server head page, persists it and pages by cursor', async () => {
    vi.mocked(workService.listByWorkspace)
      .mockResolvedValueOnce({ items: [summary('wk_1'), summary('wk_2')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [summary('wk_3')], nextCursor: null });

    renderHook(() => workActions.useFetchWorkspaceWorks(ALL), { wrapper });
    await waitFor(() => expect(galleryIds()).toEqual(['wk_1', 'wk_2']));
    expect(workService.listByWorkspace).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 30,
      provider: undefined,
      type: null,
      visibility: undefined,
    });
    await waitFor(async () =>
      expect(
        (
          await workspaceWorksResource.storage!.get({
            queryKey: workspaceWorksResource.storageKey(ALL),
            scope,
          })
        )?.data.items.map((i) => i.id),
      ).toEqual(['wk_1', 'wk_2']),
    );

    await act(() => workActions.loadMoreWorkspaceWorks(ALL));

    expect(workService.listByWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'c1' }),
    );
    expect(galleryIds()).toEqual(['wk_1', 'wk_2', 'wk_3']);
    expect(useWorkStore.getState().workspaceWorksMap[workspaceWorksKey(ALL)]?.hasMore).toBe(false);
  });

  it('keys each gallery filter and visibility as its own entry', async () => {
    vi.mocked(workService.listByWorkspace).mockImplementation(async ({ type, visibility }) => ({
      items: [summary(`${type ?? 'all'}_${visibility ?? 'any'}`)],
      nextCursor: null,
    }));
    const tasks: WorkspaceWorksParams = { type: 'task', visibility: 'private', workspaceId: 'ws' };

    renderHook(
      () => {
        workActions.useFetchWorkspaceWorks(ALL);
        workActions.useFetchWorkspaceWorks(tasks);
      },
      { wrapper },
    );

    await waitFor(() => expect(galleryIds()).toEqual(['all_any']));
    await waitFor(() => expect(galleryIds(tasks)).toEqual(['task_private']));
  });

  it('refreshWorkspaceLists revalidates a mounted gallery through its work:workspace key', async () => {
    vi.mocked(workService.listByWorkspace)
      .mockResolvedValueOnce({ items: [summary('wk_1')], nextCursor: null })
      .mockResolvedValueOnce({ items: [summary('wk_2')], nextCursor: null });
    renderHook(() => workActions.useFetchWorkspaceWorks(ALL), { wrapper });
    await waitFor(() => expect(galleryIds()).toEqual(['wk_1']));

    await act(() => workService.refreshWorkspaceLists());

    await waitFor(() => expect(galleryIds()).toEqual(['wk_2']));
  });

  it('a Work refresh drops loaded tail pages instead of keeping them stale', async () => {
    vi.mocked(workService.listByWorkspace)
      .mockResolvedValueOnce({ items: [summary('wk_1'), summary('wk_2')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [summary('wk_3', 'Before')], nextCursor: null })
      // The head is unchanged after the change, so it still holds the join anchor.
      .mockResolvedValueOnce({ items: [summary('wk_1'), summary('wk_2')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [summary('wk_3', 'Orphaned')], nextCursor: null });
    renderHook(() => workActions.useFetchWorkspaceWorks(ALL), { wrapper });
    await waitFor(() => expect(galleryIds()).toEqual(['wk_1', 'wk_2']));
    await act(() => workActions.loadMoreWorkspaceWorks(ALL));
    expect(galleryIds()).toEqual(['wk_1', 'wk_2', 'wk_3']);

    await act(() => workService.refreshWorkspaceLists());

    // The tail card is not left showing its pre-change value…
    await waitFor(() => expect(galleryIds()).toEqual(['wk_1', 'wk_2']));
    // …and comes back current when it is paged in again.
    await act(() => workActions.loadMoreWorkspaceWorks(ALL));
    const tail = useWorkStore.getState().workspaceWorksMap[workspaceWorksKey(ALL)]?.items[2];
    expect(tail?.title).toBe('Orphaned');
  });

  it('syncs the project dashboard works of one agent', async () => {
    vi.mocked(workService.listByWorkspace).mockResolvedValue({
      items: [summary('wk_a')],
      nextCursor: null,
    });

    renderHook(
      () => workActions.useFetchAgentWorks({ originAgentId: 'agt_1', workspaceId: null }),
      {
        wrapper,
      },
    );

    await waitFor(() =>
      expect(
        workSelectors
          .agentWorks('agt_1')(useWorkStore.getState())
          ?.map((i) => i.id),
      ).toEqual(['wk_a']),
    );
    expect(workService.listByWorkspace).toHaveBeenCalledWith({ limit: 4, originAgentId: 'agt_1' });
  });

  it('paints the persisted sidebar history and refreshes it through work:conversation', async () => {
    const params = { threadId: null, topicId: 'tpc_1' };
    await conversationWorksResource.storage!.set(
      { queryKey: conversationWorksResource.storageKey(params), scope },
      { data: [listItem('wk_1', 'Cached')], updatedAt: 1 },
    );
    let resolveFirst!: (items: WorkListItem[]) => void;
    vi.mocked(workService.listByConversation)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([listItem('wk_2', 'Refreshed')]);

    renderHook(() => workActions.useFetchConversationWorks(params), { wrapper });
    const history = renderHook(() => useWorkStore(workSelectors.conversationWorks(params)));

    await waitFor(() => expect(history.result.current?.map((i) => i.title)).toEqual(['Cached']));

    resolveFirst([listItem('wk_1', 'Server')]);
    await waitFor(() => expect(history.result.current?.map((i) => i.title)).toEqual(['Server']));

    await act(() => workService.refreshConversationViews('tpc_1', null));
    await waitFor(() => expect(history.result.current?.map((i) => i.title)).toEqual(['Refreshed']));
  });

  it('persists version timelines without their captured content', async () => {
    vi.mocked(workService.listVersions).mockResolvedValue([version('v1', 'a very long body')]);

    renderHook(() => workActions.useFetchWorkVersions({ workId: 'wk_1' }), { wrapper });

    await waitFor(() =>
      expect(useWorkStore.getState().workVersionsMap.wk_1?.[0]?.content).toBe('a very long body'),
    );
    await waitFor(async () => {
      const row = await workVersionsResource.storage!.get({ queryKey: 'wk_1', scope });
      expect(row?.data.map((v) => [v.id, v.content])).toEqual([['v1', null]]);
    });
  });

  it('removeWork drops the card from every list and its persisted rows', async () => {
    vi.mocked(workService.listByWorkspace).mockResolvedValue({
      items: [summary('wk_1'), summary('wk_2')],
      nextCursor: null,
    });
    vi.mocked(workService.listByConversation).mockResolvedValue([
      listItem('wk_1'),
      listItem('wk_3'),
    ]);
    const history = { topicId: 'tpc_1' };

    const { unmount } = renderHook(
      () => {
        workActions.useFetchWorkspaceWorks(ALL);
        workActions.useFetchConversationWorks(history);
      },
      { wrapper },
    );
    await waitFor(() => expect(galleryIds()).toEqual(['wk_1', 'wk_2']));
    await waitFor(() =>
      expect(workSelectors.conversationWorks(history)(useWorkStore.getState())).toHaveLength(2),
    );
    unmount();

    act(() => workActions.removeWork('wk_1'));

    expect(galleryIds()).toEqual(['wk_2']);
    expect(
      workSelectors
        .conversationWorks(history)(useWorkStore.getState())
        ?.map((i) => i.id),
    ).toEqual(['wk_3']);
    await waitFor(async () => {
      const row = await workspaceWorksResource.storage!.get({
        queryKey: workspaceWorksResource.storageKey(ALL),
        scope,
      });
      expect(row?.data.items.map((i) => i.id)).toEqual(['wk_2']);
    });
  });

  it('never hydrates another identity’s persisted gallery', async () => {
    const other = `work-user-${randomUUID()}:personal`;
    scopes.add(other);
    await workspaceWorksResource.storage!.set(
      { queryKey: workspaceWorksResource.storageKey(ALL), scope: other },
      { data: paged([summary('wk_other')]), updatedAt: 1 },
    );
    vi.mocked(workService.listByWorkspace).mockImplementation(pending);

    const sync = renderHook(() => workActions.useFetchWorkspaceWorks(ALL), { wrapper });

    await waitFor(() => expect(sync.result.current.isHydrated).toBe(true));
    expect(galleryIds()).toBeUndefined();
  });
});
