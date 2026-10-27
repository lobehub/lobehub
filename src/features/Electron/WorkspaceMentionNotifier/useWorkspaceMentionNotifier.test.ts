import { act, renderHook, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MentionNotificationRow } from './mentionNotification';

const mocks = vi.hoisted(() => ({
  enableBusinessFeatures: true,
  list: vi.fn(),
  listeners: new Set<() => void>(),
  rows: [] as MentionNotificationRow[],
  showNotification: vi.fn(),
  swrKey: undefined as unknown,
  workspaceId: 'ws_1' as string | null,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.workspaceId,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: () => 'acme',
}));
vi.mock('@/libs/swr', () => ({
  // Reactive like real SWR: a new poll result re-renders the subscriber.
  useClientPollingSWR: (key: unknown) => {
    mocks.swrKey = key;
    const rows = useSyncExternalStore(
      (listener) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
      },
      () => mocks.rows,
    );
    return { data: key ? rows : undefined };
  },
}));
vi.mock('@/services/electron/desktopNotification', () => ({
  desktopNotificationService: { showNotification: mocks.showNotification },
}));
vi.mock('@/services/notification', () => ({ notificationService: { list: mocks.list } }));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableBusinessFeatures: () => mocks.enableBusinessFeatures },
  useServerConfigStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({ authSelectors: { isLogin: () => true } }));

const { useWorkspaceMentionNotifier } = await import('./useWorkspaceMentionNotifier');

const poll = (rows: MentionNotificationRow[]) =>
  act(() => {
    mocks.rows = rows;
    for (const listener of mocks.listeners) listener();
  });

const row = (id: string): MentionNotificationRow => ({
  actionUrl: `/page/${id}`,
  content: `Bob: ping ${id}`,
  // `n1` < `n2` < …: later ids were created later.
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Number(id.slice(1)))),
  id,
  title: 'Bob mentioned you',
});

describe('useWorkspaceMentionNotifier', () => {
  beforeEach(() => {
    mocks.enableBusinessFeatures = true;
    mocks.listeners.clear();
    mocks.rows = [];
    mocks.showNotification.mockReset().mockResolvedValue({ success: true });
    mocks.swrKey = undefined;
    mocks.workspaceId = 'ws_1';
  });

  it('does not replay mentions already waiting when the watcher starts', () => {
    mocks.rows = [row('n1')];
    renderHook(() => useWorkspaceMentionNotifier());

    expect(mocks.showNotification).not.toHaveBeenCalled();
  });

  it('shows an OS notification for a mention that arrives after the baseline', async () => {
    mocks.rows = [row('n1')];
    renderHook(() => useWorkspaceMentionNotifier());

    poll([row('n2'), row('n1')]);

    await waitFor(() => expect(mocks.showNotification).toHaveBeenCalledTimes(1));
    expect(mocks.showNotification).toHaveBeenCalledWith({
      body: 'Bob: ping n2',
      navigate: { escape: true, path: '/acme/page/n2' },
      title: 'Bob mentioned you',
    });
  });

  it('stays idle outside a workspace', () => {
    mocks.workspaceId = null;
    renderHook(() => useWorkspaceMentionNotifier());

    expect(mocks.swrKey).toBeNull();
  });

  it('stays idle without business features', () => {
    mocks.enableBusinessFeatures = false;
    renderHook(() => useWorkspaceMentionNotifier());

    expect(mocks.swrKey).toBeNull();
  });
});
