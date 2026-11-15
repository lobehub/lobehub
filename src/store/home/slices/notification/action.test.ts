/**
 * @vitest-environment happy-dom
 *
 * The header inbox modal reads four replicas: the notification stream (per
 * view), its sidebar counts, the live transfer requests and their manifests.
 * A reload paints the persisted copy before the network answers; writes land
 * on the replica (and its storage) instead of relying on a best-effort refetch.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { notificationService } from '@/services/notification';
import {
  type PendingTransferRequest,
  resourceTransferRequestService,
  type TransferManifest,
} from '@/services/resourceTransferRequest';
import { useHomeStore } from '@/store/home';
import { initialHomeNotificationState } from '@/store/home/slices/notification/initialState';
import {
  INBOX_NAVIGATION_COUNTS_KEY,
  inboxNavigationCountsResource,
  type InboxNotificationFeed,
  type InboxNotificationItem,
  inboxNotificationResource,
  inboxNotificationsKey,
  PENDING_TRANSFER_REQUESTS_KEY,
  pendingTransferRequestsResource,
  transferManifestResource,
} from '@/store/home/slices/notification/projection';
import { homeNotificationSelectors } from '@/store/home/slices/notification/selectors';

const item = (id: string, isRead = false): InboxNotificationItem =>
  ({ category: 'agent', createdAt: new Date(0), id, isRead, title: id }) as InboxNotificationItem;

const feed = (items: InboxNotificationItem[]): InboxNotificationFeed => ({
  currentPage: 0,
  hasMore: false,
  items,
  nextCursor: null,
  pageSize: 20,
});

const transfer = (id: string): PendingTransferRequest =>
  ({
    createdAt: new Date(0),
    id,
    recipientId: 'me',
    resourceId: `r-${id}`,
  }) as PendingTransferRequest;

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

let scope = '';
const useScope = (next: string) => {
  scope = next;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
};

const never = <T>() => new Promise<T>(() => {});

const UNREAD = { isRead: false };
const ALL = {};

const storedFeed = async (params: object) =>
  (
    await inboxNotificationResource.storage!.get({
      queryKey: inboxNotificationsKey(params),
      scope,
    })
  )?.data as InboxNotificationFeed | undefined;

const seedFeed = (params: object, items: InboxNotificationItem[], at = scope) =>
  inboxNotificationResource.storage!.set(
    { queryKey: inboxNotificationsKey(params), scope: at },
    { data: feed(items), updatedAt: 1 },
  );

const useFeed = (params: object) =>
  renderHook(() => useHomeStore((s) => s.useFetchInboxNotifications)(params), { wrapper });

/**
 * Persist a view through the engine (so it is in the scope's row index), then
 * drop it from memory: the row is what a view not opened this session holds.
 */
const persistUnloadedView = async (params: object, items: InboxNotificationItem[]) => {
  const list = vi.spyOn(notificationService, 'list').mockResolvedValue(items);
  const { unmount } = useFeed(params);
  await waitFor(async () => expect((await storedFeed(params))?.items).toHaveLength(items.length));
  unmount();
  list.mockReset();
  act(() => useHomeStore.setState({ ...initialHomeNotificationState }));
};

const viewIds = (params: object) =>
  homeNotificationSelectors
    .notificationFeed(params)(useHomeStore.getState())
    ?.items.map((i) => i.id);

beforeEach(() => {
  useScope(`notification-user-${randomUUID()}:ws-1`);
  act(() => useHomeStore.setState({ ...initialHomeNotificationState }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('inbox notification stream replica', () => {
  it('paints the persisted head page before the network answers, then takes the server page', async () => {
    await seedFeed(UNREAD, [item('cached')]);
    let answer: (rows: InboxNotificationItem[]) => void = () => {};
    vi.spyOn(notificationService, 'list').mockImplementation(
      () => new Promise((resolve) => (answer = resolve as typeof answer)),
    );

    const { result } = useFeed(UNREAD);

    await waitFor(() => expect(viewIds(UNREAD)).toEqual(['cached']));
    expect(result.current.isValidating).toBe(true);
    expect(
      homeNotificationSelectors.isNotificationFeedConfirmed(UNREAD)(useHomeStore.getState()),
    ).toBe(false);

    act(() => answer([item('fresh')]));
    await waitFor(() => expect(viewIds(UNREAD)).toEqual(['fresh']));
    expect(
      homeNotificationSelectors.isNotificationFeedConfirmed(UNREAD)(useHomeStore.getState()),
    ).toBe(true);
  });

  it('treats a restored empty snapshot as unconfirmed until the server answers', async () => {
    await seedFeed(UNREAD, []);
    vi.spyOn(notificationService, 'list').mockImplementation(never);

    useFeed(UNREAD);

    await waitFor(() => expect(viewIds(UNREAD)).toEqual([]));
    expect(
      homeNotificationSelectors.isNotificationFeedConfirmed(UNREAD)(useHomeStore.getState()),
    ).toBe(false);
  });

  it("never paints another identity's stream", async () => {
    await seedFeed(UNREAD, [item('theirs')], 'previous-user:ws-1');
    vi.spyOn(notificationService, 'list').mockResolvedValue([item('mine')]);

    useFeed(UNREAD);

    await waitFor(() => expect(viewIds(UNREAD)).toEqual(['mine']));
  });

  it('keeps the last rows when a background refresh fails', async () => {
    await seedFeed(UNREAD, [item('cached')]);
    vi.spyOn(notificationService, 'list').mockRejectedValue(new Error('offline'));

    const { result } = useFeed(UNREAD);

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(viewIds(UNREAD)).toEqual(['cached']);
  });

  it('pages with the id of the last row and stops on a short page', async () => {
    const page = Array.from({ length: 20 }, (_, index) => item(`n${index}`));
    const list = vi
      .spyOn(notificationService, 'list')
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([item('tail')]);
    useFeed(UNREAD);
    await waitFor(() => expect(viewIds(UNREAD)).toHaveLength(20));

    await act(() => useHomeStore.getState().loadMoreInboxNotifications(UNREAD));

    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'n19', isRead: false, limit: 20 }),
    );
    expect(viewIds(UNREAD)).toHaveLength(21);
    expect(
      homeNotificationSelectors.notificationFeed(UNREAD)(useHomeStore.getState())?.hasMore,
    ).toBe(false);
  });

  it('drops an archived row from every view and from storage, so a reload cannot restore it', async () => {
    await persistUnloadedView(ALL, [item('a'), item('b')]);
    vi.spyOn(notificationService, 'list').mockResolvedValue([item('a'), item('b')]);
    vi.spyOn(notificationService, 'archive').mockResolvedValue(undefined as never);
    useFeed(UNREAD);
    await waitFor(() => expect(viewIds(UNREAD)).toEqual(['a', 'b']));

    await act(() => useHomeStore.getState().archiveInboxNotification('a', UNREAD));

    expect(viewIds(UNREAD)).toEqual(['b']);
    await waitFor(async () =>
      expect((await storedFeed(UNREAD))?.items.map((i) => i.id)).toEqual(['b']),
    );
    // The all view was never opened in this session: its persisted copy is patched too.
    await waitFor(async () =>
      expect((await storedFeed(ALL))?.items.map((i) => i.id)).toEqual(['b']),
    );
  });

  it('rolls an archive back when the server rejects it', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue([item('a')]);
    vi.spyOn(notificationService, 'archive').mockRejectedValue(new Error('denied'));
    useFeed(UNREAD);
    await waitFor(() => expect(viewIds(UNREAD)).toEqual(['a']));

    await act(async () => {
      await expect(useHomeStore.getState().archiveInboxNotification('a', UNREAD)).rejects.toThrow(
        'denied',
      );
    });

    expect(viewIds(UNREAD)).toEqual(['a']);
  });

  it('persists a read row as read in the other views', async () => {
    await persistUnloadedView(ALL, [item('a')]);
    vi.spyOn(notificationService, 'list').mockResolvedValue([item('a')]);
    vi.spyOn(notificationService, 'markAsRead').mockResolvedValue(undefined as never);
    useFeed(UNREAD);
    await waitFor(() => expect(viewIds(UNREAD)).toEqual(['a']));

    await act(() => useHomeStore.getState().markInboxNotificationRead('a', UNREAD));

    expect(
      homeNotificationSelectors.notificationFeed(UNREAD)(useHomeStore.getState())?.items[0].isRead,
    ).toBe(true);
    await waitFor(async () => expect((await storedFeed(ALL))?.items[0].isRead).toBe(true));
  });

  it('empties every persisted view after archive-all', async () => {
    await persistUnloadedView(ALL, [item('a')]);
    vi.spyOn(notificationService, 'list').mockResolvedValue([item('a'), item('b')]);
    vi.spyOn(notificationService, 'archiveAll').mockResolvedValue(undefined as never);
    useFeed(UNREAD);
    await waitFor(() => expect(viewIds(UNREAD)).toEqual(['a', 'b']));

    await act(() => useHomeStore.getState().archiveAllInboxNotifications(UNREAD));

    expect(viewIds(UNREAD)).toEqual([]);
    await waitFor(async () => expect((await storedFeed(UNREAD))?.items).toEqual([]));
    await waitFor(async () => expect((await storedFeed(ALL))?.items).toEqual([]));
  });
});

describe('inbox navigation counts replica', () => {
  it('paints the persisted counts before the network answers', async () => {
    await inboxNavigationCountsResource.storage!.set(
      { queryKey: INBOX_NAVIGATION_COUNTS_KEY, scope },
      {
        data: [{ category: 'agent', readCount: 1, totalCount: 3, unreadCount: 2 }],
        updatedAt: 1,
      },
    );
    vi.spyOn(notificationService, 'getNavigationCounts').mockImplementation(never);

    renderHook(() => useHomeStore((s) => s.useFetchInboxNavigationCounts)(), { wrapper });

    await waitFor(() =>
      expect(
        homeNotificationSelectors.navigationCounts(useHomeStore.getState())?.[0].unreadCount,
      ).toBe(2),
    );
    expect(homeNotificationSelectors.isNavigationCountsConfirmed(useHomeStore.getState())).toBe(
      false,
    );
  });
});

describe('pending transfer requests replica', () => {
  it('serves the modal header and the stream with one request', async () => {
    const listMine = vi.spyOn(resourceTransferRequestService, 'listMine').mockResolvedValue([]);

    renderHook(
      () => {
        useHomeStore((s) => s.useFetchPendingTransferRequests)(true);
        useHomeStore((s) => s.useFetchPendingTransferRequests)(true);
      },
      { wrapper },
    );

    await waitFor(() =>
      expect(homeNotificationSelectors.pendingTransferRequests(useHomeStore.getState())).toEqual(
        [],
      ),
    );
    expect(listMine).toHaveBeenCalledTimes(1);
  });

  it('paints persisted requests, but only a server answer confirms they are live', async () => {
    await pendingTransferRequestsResource.storage!.set(
      { queryKey: PENDING_TRANSFER_REQUESTS_KEY, scope },
      { data: [transfer('t1')], updatedAt: 1 },
    );
    vi.spyOn(resourceTransferRequestService, 'listMine').mockImplementation(never);

    renderHook(() => useHomeStore((s) => s.useFetchPendingTransferRequests)(true), { wrapper });

    await waitFor(() =>
      expect(
        homeNotificationSelectors
          .pendingTransferRequests(useHomeStore.getState())
          ?.map((r) => r.id),
      ).toEqual(['t1']),
    );
    expect(
      homeNotificationSelectors.isPendingTransferRequestsConfirmed(useHomeStore.getState()),
    ).toBe(false);
  });

  it('drops a settled request from the list and storage even when the re-read fails', async () => {
    vi.spyOn(resourceTransferRequestService, 'listMine')
      .mockResolvedValueOnce([transfer('t1'), transfer('t2')])
      .mockRejectedValue(new Error('offline'));
    renderHook(() => useHomeStore((s) => s.useFetchPendingTransferRequests)(true), { wrapper });
    await waitFor(() =>
      expect(
        homeNotificationSelectors.pendingTransferRequests(useHomeStore.getState()),
      ).toHaveLength(2),
    );

    await act(async () => {
      await expect(useHomeStore.getState().settleTransferRequest('t1', true)).rejects.toThrow(
        'offline',
      );
    });

    expect(
      homeNotificationSelectors.pendingTransferRequests(useHomeStore.getState())?.map((r) => r.id),
    ).toEqual(['t2']);
    await waitFor(async () =>
      expect(
        (
          await pendingTransferRequestsResource.storage!.get({
            queryKey: PENDING_TRANSFER_REQUESTS_KEY,
            scope,
          })
        )?.data.map((r) => r.id),
      ).toEqual(['t2']),
    );
  });
});

describe('transfer manifest replica', () => {
  const params = {
    recipientId: 'me',
    requestId: 't1',
    resourceId: 'agent-1',
    resourceType: 'agent' as const,
  };
  const manifest = { hiddenReferencedMember: false, tasksToDetach: 2 } as TransferManifest;

  it('paints a persisted manifest without treating it as confirmed', async () => {
    await transferManifestResource.storage!.set(
      { queryKey: 't1', scope },
      { data: manifest, updatedAt: 1 },
    );
    let answer: (value: TransferManifest) => void = () => {};
    vi.spyOn(resourceTransferRequestService, 'getManifest').mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );

    renderHook(() => useHomeStore((s) => s.useFetchTransferManifest)(params), { wrapper });

    await waitFor(() =>
      expect(
        homeNotificationSelectors.transferManifest('t1')(useHomeStore.getState())?.tasksToDetach,
      ).toBe(2),
    );
    expect(
      homeNotificationSelectors.isTransferManifestConfirmed('t1')(useHomeStore.getState()),
    ).toBe(false);

    act(() => answer({ ...manifest, tasksToDetach: 3 }));
    await waitFor(() =>
      expect(
        homeNotificationSelectors.isTransferManifestConfirmed('t1')(useHomeStore.getState()),
      ).toBe(true),
    );
    expect(
      homeNotificationSelectors.transferManifest('t1')(useHomeStore.getState())?.tasksToDetach,
    ).toBe(3);
  });
});
