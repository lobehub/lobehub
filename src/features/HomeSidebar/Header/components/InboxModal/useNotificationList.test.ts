/**
 * @vitest-environment happy-dom
 *
 * Reopening the inbox after a reload paints the last notifications from the
 * local replica while the server is still answering — no skeleton.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage, cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { notificationService } from '@/services/notification';

import { useNotificationList } from './useNotificationList';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
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

let scope = '';

const row = (id: string, isRead: boolean, title = id) => ({
  category: 'agent',
  createdAt: new Date(0),
  id,
  isRead,
  title,
  type: 'agent',
});

/**
 * Written in the replica's row layout (`replica:<name>:v<version>`, entry
 * `<category>:<read state>`), so the test needs nothing of the replica module:
 * before the migration the stream ignored the local copy and showed nothing
 * until the request returned.
 */
const seedUnreadView = (items: ReturnType<typeof row>[]) =>
  new AppIndexedDBStorage({ namespace: 'replica:inboxNotifications:v1' }).set(
    { queryKey: '*:unread', scope },
    {
      data: { currentPage: 0, hasMore: false, items, nextCursor: null, pageSize: 20 },
      updatedAt: 1,
    },
  );

beforeEach(() => {
  scope = `inbox-list-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useNotificationList', () => {
  it('paints the persisted unread notifications before the network answers', async () => {
    await seedUnreadView([row('n1', false, 'Cached notification')]);
    let answer: (rows: unknown[]) => void = () => {};
    vi.spyOn(notificationService, 'list').mockImplementation(
      () => new Promise((resolve) => (answer = resolve as typeof answer)) as never,
    );

    const { result } = renderHook(() => useNotificationList({ isRead: false }), { wrapper });

    await waitFor(() =>
      expect(result.current.notifications?.map((item) => item.id)).toEqual(['n1']),
    );
    expect(result.current.isConfirmed).toBe(false);

    act(() => answer([row('n2', false)]));
    await waitFor(() =>
      expect(result.current.notifications?.map((item) => item.id)).toEqual(['n2']),
    );
    expect(result.current.isConfirmed).toBe(true);
  });

  it('keeps a row read from another view off the unread view', async () => {
    await seedUnreadView([row('read-elsewhere', true), row('n1', false)]);
    vi.spyOn(notificationService, 'list').mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useNotificationList({ isRead: false }), { wrapper });

    await waitFor(() =>
      expect(result.current.notifications?.map((item) => item.id)).toEqual(['n1']),
    );
  });

  it('reports a failed refresh of an unconfirmed restored view, keeping its rows', async () => {
    await seedUnreadView([]);
    vi.spyOn(notificationService, 'list').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useNotificationList({ isRead: false }), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isConfirmed).toBe(false);
    expect(result.current.notifications).toEqual([]);
    // Rows were restored, so this is not a first-load failure with nothing to show.
    expect(result.current.headError).toBeUndefined();
  });

  it('keeps the restored rows and surfaces a failed refresh for the inline retry', async () => {
    await seedUnreadView([row('n1', false, 'Cached notification')]);
    vi.spyOn(notificationService, 'list').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useNotificationList({ isRead: false }), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.notifications?.map((item) => item.id)).toEqual(['n1']);
    expect(result.current.headError).toBeUndefined();
  });

  it('surfaces a failed refresh after a confirmed empty answer', async () => {
    const list = vi.spyOn(notificationService, 'list').mockResolvedValueOnce([]);

    const { result } = renderHook(() => useNotificationList({ isRead: false }), { wrapper });
    await waitFor(() => expect(result.current.isConfirmed).toBe(true));
    expect(result.current.notifications).toEqual([]);

    list.mockRejectedValue(new Error('offline'));
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.notifications).toEqual([]);
  });
});
