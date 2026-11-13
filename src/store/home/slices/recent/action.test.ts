/**
 * @vitest-environment happy-dom
 *
 * Recents are a replica: the sidebar paints the persisted rows on the first
 * frame, and a rename shows at once in every loaded recents query.
 */
import { randomUUID } from 'node:crypto';

import type { RecentItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { replicaKeys } from 'local-replica';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, unstable_serialize, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { CACHE_TIERS } from '@/libs/swr/localStorageProvider';
import { setScopedMutate } from '@/libs/swr/mutate';
import { fileService } from '@/services/file';
import { recentService } from '@/services/recent';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';
import { useHomeStore } from '@/store/home';
import { HOME_TOPIC_RECENTS_PARAMS, TRAY_RECENTS_PARAMS } from '@/store/home/slices/recent/action';
import {
  createConversationRecentQueryKey,
  createRecentQueryKey,
  initialRecentState,
} from '@/store/home/slices/recent/initialState';
import { docsHomeListResource, recentListResource } from '@/store/home/slices/recent/projection';
import { homeRecentSelectors } from '@/store/home/slices/recent/selectors';

const item = (id: string, title: string, type: RecentItem['type'] = 'task'): RecentItem => ({
  icon: type,
  id,
  routePath: '/',
  status: null,
  title,
  type,
  updatedAt: new Date(0),
});

type TaskUpdateResult = Awaited<ReturnType<typeof taskService.update>>;
const taskUpdateResult = {} as TaskUpdateResult;

const deferred = <T>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
};

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

const SIDEBAR = createRecentQueryKey(11);
const DRAWER = createRecentQueryKey(50);
const titleOf = (queryKey: string, ref: `${RecentItem['type']}:${string}`) =>
  homeRecentSelectors.item(queryKey, ref)(useHomeStore.getState())?.title;

let scope = '';
const useScope = (next: string) => {
  scope = next;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
};

/** Load the sidebar (10 + 1 rows) and, optionally, the drawer through the real sync path. */
const load = async (sidebar: RecentItem[], drawer?: RecentItem[]) => {
  vi.spyOn(recentService, 'getAll').mockImplementation(async (limit) =>
    limit === 50 ? (drawer ?? []) : sidebar,
  );
  renderHook(
    () => {
      useHomeStore((s) => s.useFetchRecents)(true, 10);
      useHomeStore((s) => s.useFetchAllRecents)(!!drawer);
    },
    { wrapper },
  );
  await waitFor(() => {
    expect(useHomeStore.getState().recentListMap[SIDEBAR]).toBeDefined();
    if (drawer) expect(useHomeStore.getState().recentListMap[DRAWER]).toBeDefined();
  });
};

beforeEach(() => {
  useScope(`recent-user-${randomUUID()}:personal`);
  act(() => useHomeStore.setState({ ...initialRecentState }));
  vi.spyOn(fileService, 'getDocsHomeItems').mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('recents replica', () => {
  it('paints the persisted rows before the network answers', async () => {
    await recentListResource.storage!.set(
      { queryKey: recentListResource.storageKey({ limit: 11 }), scope },
      { data: [item('a', 'Cached')], updatedAt: 1 },
    );
    vi.spyOn(recentService, 'getAll').mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useHomeStore((s) => s.useFetchRecents)(true, 10), {
      wrapper,
    });

    await waitFor(() => expect(titleOf(SIDEBAR, 'task:a')).toBe('Cached'));
    expect(result.current.isValidating).toBe(true);
  });

  it('fetches topic recents with previews for the conversation list', async () => {
    const getAll = vi
      .spyOn(recentService, 'getAll')
      .mockImplementation(async () => [item('t1', 'Topic', 'topic')]);
    const conversations = createConversationRecentQueryKey(50);

    renderHook(() => useHomeStore((s) => s.useFetchConversationRecents)(50), { wrapper });

    await waitFor(() =>
      expect(
        homeRecentSelectors.conversationRecents(conversations)(useHomeStore.getState()),
      ).toHaveLength(1),
    );
    // Topics with previews: the IM rows show the latest reply, not the title.
    expect(getAll).toHaveBeenCalledWith(50, ['topic'], true);
  });

  it('does not fetch while logged out', () => {
    const getAll = vi.spyOn(recentService, 'getAll');
    renderHook(() => useHomeStore((s) => s.useFetchRecents)(false, 10), { wrapper });
    expect(getAll).not.toHaveBeenCalled();
  });

  it('shows an optimistic title and rolls it back when persistence fails', async () => {
    await load([item('a', 'Old')]);
    const request = deferred<TaskUpdateResult>();
    vi.spyOn(taskService, 'update').mockReturnValue(request.promise);

    const renamePromise = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'Draft', type: 'task' });
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Draft');

    request.reject(new Error('failed'));
    await expect(renamePromise).rejects.toThrow('failed');
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Old');
  });

  it('renames the entity in every loaded query, not same-id rows of other types', async () => {
    await load(
      [item('same', 'Task')],
      [item('same', 'Task'), item('same', 'Document', 'document')],
    );
    vi.spyOn(taskService, 'update').mockResolvedValue(taskUpdateResult);

    await act(() =>
      useHomeStore.getState().renameRecent({ id: 'same', title: 'Renamed', type: 'task' }),
    );

    expect(titleOf(SIDEBAR, 'task:same')).toBe('Renamed');
    expect(titleOf(DRAWER, 'task:same')).toBe('Renamed');
    expect(titleOf(DRAWER, 'document:same')).toBe('Document');
  });

  it('carries the slug source with a task rename', async () => {
    await load([item('a', 'Old')]);
    vi.spyOn(taskService, 'update').mockResolvedValue(taskUpdateResult);

    await act(() => useHomeStore.getState().renameRecent({ id: 'a', title: 'New', type: 'task' }));

    expect(homeRecentSelectors.item(SIDEBAR, 'task:a')(useHomeStore.getState())).toMatchObject({
      slugTitle: 'New',
      title: 'New',
    });
  });

  it('serializes repeated renames and keeps the latest optimistic title', async () => {
    await load([item('a', 'Old')]);
    const firstRequest = deferred<TaskUpdateResult>();
    const secondRequest = deferred<TaskUpdateResult>();
    const updateSpy = vi
      .spyOn(taskService, 'update')
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const firstRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'First', type: 'task' });
    const secondRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'Second', type: 'task' });

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Second');

    firstRequest.resolve(taskUpdateResult);
    await firstRename;
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Second');

    secondRequest.resolve(taskUpdateResult);
    await secondRename;
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Second');
  });

  it('keeps a newer pending rename when an older one fails', async () => {
    await load([item('a', 'Old')]);
    const firstRequest = deferred<TaskUpdateResult>();
    const secondRequest = deferred<TaskUpdateResult>();
    vi.spyOn(taskService, 'update')
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const firstRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'First', type: 'task' });
    const secondRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'Second', type: 'task' });

    firstRequest.reject(new Error('failed'));
    await expect(firstRename).rejects.toThrow('failed');
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Second');

    secondRequest.resolve(taskUpdateResult);
    await secondRename;
  });
});

const HOME_TOPICS = createRecentQueryKey(HOME_TOPIC_RECENTS_PARAMS.limit, {
  types: HOME_TOPIC_RECENTS_PARAMS.types,
  view: HOME_TOPIC_RECENTS_PARAMS.view,
});
const TRAY = createRecentQueryKey(TRAY_RECENTS_PARAMS.limit, {
  types: TRAY_RECENTS_PARAMS.types,
  view: TRAY_RECENTS_PARAMS.view,
});
const rowsOf = (queryKey: string) => homeRecentSelectors.query(queryKey)(useHomeStore.getState());
const seed = (
  params: typeof HOME_TOPIC_RECENTS_PARAMS | typeof TRAY_RECENTS_PARAMS,
  rows: RecentItem[],
  at = scope,
) =>
  recentListResource.storage!.set(
    { queryKey: recentListResource.storageKey(params), scope: at },
    { data: rows, updatedAt: 1 },
  );

describe('Home topic and tray recents on the recentList replica', () => {
  it('keeps each query in its own entry, apart from the sidebar', () => {
    expect(new Set([SIDEBAR, DRAWER, HOME_TOPICS, TRAY]).size).toBe(4);
    // Sidebar entries keep their original key, so persisted rows still hydrate.
    expect(SIDEBAR).toBe('limit:11');
  });

  it('keeps the new sync keys out of the legacy SWR persistence tiers', () => {
    for (const params of [HOME_TOPIC_RECENTS_PARAMS, TRAY_RECENTS_PARAMS]) {
      const serialized = unstable_serialize(
        replicaKeys.sync(
          recentListResource.name,
          recentListResource.version,
          scope,
          recentListResource.key(params),
          params,
        ),
      );
      expect(
        [...CACHE_TIERS.idb, ...CACHE_TIERS.local].filter((pattern) =>
          serialized.includes(pattern),
        ),
      ).toEqual([]);
    }
  });

  it('asks the server for the same rows as before', async () => {
    const getAll = vi.spyOn(recentService, 'getAll').mockResolvedValue([]);

    renderHook(
      () => {
        useHomeStore((s) => s.useFetchHomeTopicRecents)(true);
        useHomeStore((s) => s.useFetchTrayRecents)(true);
      },
      { wrapper },
    );

    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));
    // Home: own topics with previews; tray: own recents of every type.
    expect(getAll).toHaveBeenCalledWith(15, ['topic'], true, true, false);
    expect(getAll).toHaveBeenCalledWith(10, undefined, false, true, false);
  });

  it('paints persisted Home topics and tray rows before the network, then replaces them', async () => {
    await seed(HOME_TOPIC_RECENTS_PARAMS, [item('t1', 'Cached topic', 'topic')]);
    await seed(TRAY_RECENTS_PARAMS, [item('d1', 'Cached doc', 'document')]);
    const response = deferred<RecentItem[]>();
    vi.spyOn(recentService, 'getAll').mockReturnValue(response.promise);

    renderHook(
      () => {
        useHomeStore((s) => s.useFetchHomeTopicRecents)(true);
        useHomeStore((s) => s.useFetchTrayRecents)(true);
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(rowsOf(HOME_TOPICS)?.[0].title).toBe('Cached topic');
      expect(rowsOf(TRAY)?.[0].title).toBe('Cached doc');
    });
    expect(homeRecentSelectors.isQueryConfirmed(HOME_TOPICS)(useHomeStore.getState())).toBe(false);

    await act(async () => response.resolve([item('t2', 'Fresh', 'topic')]));

    await waitFor(() => {
      expect(rowsOf(HOME_TOPICS)?.map((row) => row.title)).toEqual(['Fresh']);
      expect(rowsOf(TRAY)?.map((row) => row.title)).toEqual(['Fresh']);
    });
    expect(homeRecentSelectors.isQueryConfirmed(HOME_TOPICS)(useHomeStore.getState())).toBe(true);
  });

  it('treats a hydrated empty snapshot as unconfirmed until the server answers', async () => {
    await seed(HOME_TOPIC_RECENTS_PARAMS, []);
    const response = deferred<RecentItem[]>();
    vi.spyOn(recentService, 'getAll').mockReturnValue(response.promise);

    const { result } = renderHook(() => useHomeStore((s) => s.useFetchHomeTopicRecents)(true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(rowsOf(HOME_TOPICS)).toEqual([]);
    expect(homeRecentSelectors.isQueryConfirmed(HOME_TOPICS)(useHomeStore.getState())).toBe(false);

    await act(async () => response.resolve([]));
    await waitFor(() =>
      expect(homeRecentSelectors.isQueryConfirmed(HOME_TOPICS)(useHomeStore.getState())).toBe(true),
    );
  });

  it("never paints another identity's rows", async () => {
    await seed(HOME_TOPIC_RECENTS_PARAMS, [item('t1', 'Theirs', 'topic')], `${scope}-other`);
    vi.spyOn(recentService, 'getAll').mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useHomeStore((s) => s.useFetchHomeTopicRecents)(true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(rowsOf(HOME_TOPICS)).toBeUndefined();
  });

  it('keeps the last rows when a background refresh fails', async () => {
    const getAll = vi
      .spyOn(recentService, 'getAll')
      .mockResolvedValueOnce([item('t1', 'Kept', 'topic')]);
    const { result } = renderHook(() => useHomeStore((s) => s.useFetchTrayRecents)(true), {
      wrapper,
    });
    await waitFor(() => expect(rowsOf(TRAY)?.[0].title).toBe('Kept'));

    getAll.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.revalidate().catch(() => undefined);
    });

    expect(rowsOf(TRAY)?.map((row) => row.title)).toEqual(['Kept']);
  });

  it('sends one request when several surfaces mount the same query', async () => {
    const getAll = vi.spyOn(recentService, 'getAll').mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ late }: { late: boolean }) => {
        useHomeStore((s) => s.useFetchTrayRecents)(true);
        useHomeStore((s) => s.useFetchTrayRecents)(true);
        // A surface that mounts after the first answer (e.g. the titlebar remounting).
        useHomeStore((s) => s.useFetchTrayRecents)(late);
      },
      { initialProps: { late: false }, wrapper },
    );
    await waitFor(() => expect(rowsOf(TRAY)).toEqual([]));
    rerender({ late: true });
    await act(async () => {});

    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('refreshes the tray on demand even inside the dedupe window', async () => {
    const getAll = vi.spyOn(recentService, 'getAll').mockResolvedValue([]);
    const { result } = renderHook(() => useHomeStore((s) => s.useFetchTrayRecents)(true), {
      wrapper,
    });
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(1));

    getAll.mockResolvedValueOnce([item('t1', 'Now running', 'topic')]);
    await act(() => result.current.revalidate());

    expect(getAll).toHaveBeenCalledTimes(2);
    expect(rowsOf(TRAY)?.[0].title).toBe('Now running');
  });

  it('carries a rename into the Home topics and the tray, and persists it', async () => {
    vi.spyOn(recentService, 'getAll').mockResolvedValue([item('t1', 'Old', 'topic')]);
    vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as never);
    renderHook(
      () => {
        useHomeStore((s) => s.useFetchHomeTopicRecents)(true);
        useHomeStore((s) => s.useFetchTrayRecents)(true);
      },
      { wrapper },
    );
    await waitFor(() => expect(rowsOf(TRAY)).toHaveLength(1));
    await waitFor(() => expect(rowsOf(HOME_TOPICS)).toHaveLength(1));

    await act(() =>
      useHomeStore.getState().renameRecent({ id: 't1', title: 'New', type: 'topic' }),
    );

    expect(rowsOf(HOME_TOPICS)?.[0].title).toBe('New');
    expect(rowsOf(TRAY)?.[0].title).toBe('New');
    await waitFor(async () =>
      expect(
        (
          await recentListResource.storage!.get({
            queryKey: recentListResource.storageKey(TRAY_RECENTS_PARAMS),
            scope,
          })
        )?.data[0].title,
      ).toBe('New'),
    );
  });

  it('refetches the Home topics and the tray with the other recents', async () => {
    const getAll = vi.spyOn(recentService, 'getAll').mockResolvedValue([]);
    renderHook(
      () => {
        useHomeStore((s) => s.useFetchHomeTopicRecents)(true);
        useHomeStore((s) => s.useFetchTrayRecents)(true);
      },
      { wrapper },
    );
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));

    await act(() => useHomeStore.getState().refreshRecents());

    expect(getAll).toHaveBeenCalledTimes(4);
  });
});

type DocsHomeItem = Awaited<ReturnType<typeof fileService.getDocsHomeItems>>[number];

const homeItem = (id: string, sourceType: 'document' | 'file' = 'document'): DocsHomeItem =>
  ({
    createdAt: new Date(0),
    fileType: sourceType === 'document' ? 'custom/document' : 'image/png',
    id,
    knowledgeBaseIds: ['kb-1'],
    metadata: { emoji: '📄', heavy: 'x'.repeat(10) },
    name: id,
    sourceType,
    updatedAt: new Date(0),
    uploader: { avatar: null, fullName: 'Ada', id: 'user-1', username: 'ada' },
    userId: 'user-1',
  }) as unknown as DocsHomeItem;

const storedRow = <T>(
  resource: { storage?: { get: (key: { queryKey: string; scope: string }) => Promise<T> } },
  queryKey: string,
) => resource.storage!.get({ queryKey, scope });

describe('docs home list replica', () => {
  it('paints the persisted rows before the network answers', async () => {
    await docsHomeListResource.storage!.set(
      { queryKey: 'recent', scope },
      {
        data: [
          {
            createdAt: new Date(0),
            fileType: 'custom/document',
            id: 'p1',
            knowledgeBaseIds: [],
            kind: 'page',
            name: 'Cached page',
            updatedAt: new Date(0),
          },
        ],
        updatedAt: 1,
      },
    );

    const { result } = renderHook(() => useHomeStore((s) => s.useFetchDocsHome)('recent'), {
      wrapper,
    });

    await waitFor(() =>
      expect(homeRecentSelectors.docsHome('recent')(useHomeStore.getState())?.[0].name).toBe(
        'Cached page',
      ),
    );
    expect(result.current.isValidating).toBe(true);
  });

  it('keeps each tab in its own entry', async () => {
    vi.mocked(fileService.getDocsHomeItems).mockImplementation(async (tab) => [
      homeItem(`row-${tab}`),
    ]);

    renderHook(
      () => {
        useHomeStore((s) => s.useFetchDocsHome)('mine');
        useHomeStore((s) => s.useFetchDocsHome)('shared');
      },
      { wrapper },
    );

    await waitFor(() => {
      const state = useHomeStore.getState();
      expect(homeRecentSelectors.docsHome('mine')(state)?.[0].id).toBe('row-mine');
      expect(homeRecentSelectors.docsHome('shared')(state)?.[0].id).toBe('row-shared');
    });
  });

  it('persists slim rows with kind, location and owner', async () => {
    vi.mocked(fileService.getDocsHomeItems).mockResolvedValue([
      homeItem('p1'),
      homeItem('f1', 'file'),
    ]);

    renderHook(() => useHomeStore((s) => s.useFetchDocsHome)('recent'), { wrapper });

    await waitFor(async () =>
      expect((await storedRow(docsHomeListResource, 'recent'))?.data).toEqual([
        {
          createdAt: new Date(0),
          emoji: '📄',
          fileType: 'custom/document',
          id: 'p1',
          knowledgeBaseIds: ['kb-1'],
          kind: 'page',
          name: 'p1',
          owner: { avatar: null, id: 'user-1', name: 'Ada' },
          updatedAt: new Date(0),
          userId: 'user-1',
        },
        expect.objectContaining({ id: 'f1', kind: 'file' }),
      ]),
    );
    expect(JSON.stringify(localStorage)).not.toContain('heavy');
  });

  it("never paints another workspace's rows", async () => {
    await docsHomeListResource.storage!.set(
      { queryKey: 'recent', scope: `${scope}-other-workspace` },
      {
        data: [
          {
            createdAt: new Date(0),
            fileType: 'image/png',
            id: 'x',
            knowledgeBaseIds: [],
            kind: 'file',
            name: 'Theirs',
            updatedAt: new Date(0),
          },
        ],
        updatedAt: 1,
      },
    );

    const { result } = renderHook(() => useHomeStore((s) => s.useFetchDocsHome)('recent'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(homeRecentSelectors.docsHome('recent')(useHomeStore.getState())).toBeUndefined();
  });
});
