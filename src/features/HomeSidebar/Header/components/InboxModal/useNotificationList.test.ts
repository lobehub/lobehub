import { renderHook, waitFor } from '@testing-library/react';
import { act, createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationListHandle } from './useNotificationList';
import { useNotificationList } from './useNotificationList';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

const listMock = vi.fn();

vi.mock('@/services/notification', () => ({
  notificationService: {
    list: (...args: unknown[]) => listMock(...args),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const setup = async (initialItems: { content: string; id: string }[]) => {
  let items = initialItems;
  listMock.mockImplementation(async () => items);
  let handle: NotificationListHandle | undefined;

  const { result } = renderHook(
    () =>
      useNotificationList({
        isRead: false,
        registerHandle: (h) => {
          handle = h;
        },
      }),
    { wrapper },
  );

  await waitFor(() => expect(result.current.data?.flat()).toEqual(initialItems));
  expect(handle).toBeDefined();

  return {
    handle: handle!,
    result,
    setItems: (next: typeof items) => {
      items = next;
    },
  };
};

describe('useNotificationList', () => {
  it('registers a refresh that revalidates the infinite list', async () => {
    // Regression: modal bulk actions (mark all as read) used a key-filter
    // mutate, which SWR skips for `$inf$` infinite keys — the unread list
    // never refreshed. The hook must expose its own bound revalidate instead.
    const { handle, result, setItems } = await setup([{ content: 'first', id: '1' }]);

    setItems([]);
    await act(async () => {
      handle.refresh();
    });

    await waitFor(() => expect(result.current.data?.flat()).toEqual([]));
  });

  it('optimistically removes a single item without refetching', async () => {
    const first = { content: 'first', id: '1' };
    const second = { content: 'second', id: '2' };
    const { handle, result } = await setup([first, second]);
    const callsBefore = listMock.mock.calls.length;

    await act(async () => {
      handle.optimisticRemove('1');
    });

    expect(result.current.data?.flat()).toEqual([second]);
    expect(listMock.mock.calls.length).toBe(callsBefore);
  });

  it('optimistically clears the list without refetching', async () => {
    const { handle, result } = await setup([{ content: 'first', id: '1' }]);
    const callsBefore = listMock.mock.calls.length;

    await act(async () => {
      handle.optimisticClear();
    });

    expect(result.current.data?.flat() ?? []).toEqual([]);
    expect(listMock.mock.calls.length).toBe(callsBefore);
  });

  it('omits the isRead filter for the combined "all" view', async () => {
    // Regression: the hook always forwarded a boolean isRead, so the combined
    // chronological history (no read-state filter) was impossible to request.
    listMock.mockClear();
    listMock.mockImplementation(async () => []);

    renderHook(() => useNotificationList({ registerHandle: () => {} }), { wrapper });

    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect((listMock.mock.calls[0][0] as { isRead?: boolean }).isRead).toBeUndefined();
  });
});
