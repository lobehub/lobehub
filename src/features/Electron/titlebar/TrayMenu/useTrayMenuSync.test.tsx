/**
 * @vitest-environment happy-dom
 */
import { randomUUID } from 'node:crypto';

import type { RecentItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { recentService } from '@/services/recent';
import { useHomeStore } from '@/store/home';
import { initialRecentState } from '@/store/home/slices/recent/initialState';
import { recentListResource } from '@/store/home/slices/recent/projection';

import { useTrayMenuSync } from './useTrayMenuSync';

const mocks = vi.hoisted(() => ({
  agents: [{ id: 'agent-1', title: 'Researcher', updatedAt: '2026-07-11T00:00:00.000Z' }],
  activeTopics: [] as { status: string; topicId: string }[],
  isLogin: true,
  useFetchAgentList: vi.fn(),
  updateNavigationSnapshot: vi.fn(),
}));

vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: mocks.useFetchAgentList }));

vi.mock('@/services/electron/tray', () => ({
  desktopTrayService: { updateNavigationSnapshot: mocks.updateNavigationSnapshot },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: vi.fn(() => mocks.activeTopics),
}));

vi.mock('@/store/user', () => ({
  useUserStore: vi.fn(() => mocks.isLogin),
}));

vi.mock('@/store/home/slices/agentList/selectors', () => ({
  homeAgentListSelectors: { allAgents: () => mocks.agents },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: vi.fn((selector) => selector({ activeRecentScope: { type: 'personal' } })),
}));

vi.mock('../RecentlyViewed/hooks/useResolvedPages', () => ({
  useResolvedPages: () => ({
    pinnedPages: [],
    recentPages: [
      {
        isActive: false,
        meta: { title: 'Research' },
        tab: {
          id: '/agent/agent-1/topic-1',
          lastVisited: 1,
          url: '/agent/agent-1/topic-1',
        },
      },
    ],
  }),
}));

const TRAY_PARAMS = { limit: 10, types: 'all', view: 'mine' } as const;

const topic = (id: string, title: string): RecentItem => ({
  agentId: 'agent-1',
  icon: 'topic',
  id,
  routePath: `/agent/agent-1/${id}`,
  status: null,
  title,
  type: 'topic',
  updatedAt: new Date(0),
});

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

let scope = '';
const lastSnapshot = () => mocks.updateNavigationSnapshot.mock.lastCall?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeTopics = [];
  mocks.isLogin = true;
  mocks.updateNavigationSnapshot.mockResolvedValue({ success: true });
  scope = `tray-user-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  act(() => useHomeStore.setState({ ...initialRecentState }));
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useTrayMenuSync', () => {
  it('pushes the persisted tray recents before the network answers, then the fresh ones', async () => {
    await recentListResource.storage!.set(
      { queryKey: recentListResource.storageKey(TRAY_PARAMS), scope },
      { data: [topic('topic-1', 'Cached research')], updatedAt: 1 },
    );
    let answer!: (rows: RecentItem[]) => void;
    const getAll = vi
      .spyOn(recentService, 'getAll')
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));

    renderHook(() => useTrayMenuSync(), { wrapper });

    await waitFor(() =>
      expect(lastSnapshot()?.recent).toEqual([
        { subtitle: 'Researcher', title: 'Cached research', url: '/agent/agent-1/topic-1' },
      ]),
    );
    expect(getAll).toHaveBeenCalledWith(10, undefined, false, true, false);

    await act(async () => answer([topic('topic-1', 'Fresh research')]));

    await waitFor(() =>
      expect(lastSnapshot()?.recent).toEqual([
        { subtitle: 'Researcher', title: 'Fresh research', url: '/agent/agent-1/topic-1' },
      ]),
    );
  });

  it('pushes resolved navigation data and does not resend an identical render', async () => {
    vi.spyOn(recentService, 'getAll').mockResolvedValue([topic('topic-1', 'Research')]);
    const { rerender } = renderHook(() => useTrayMenuSync(), { wrapper });

    await waitFor(() =>
      expect(mocks.updateNavigationSnapshot).toHaveBeenLastCalledWith({
        activeTopics: [],
        agents: [{ id: 'agent-1', title: 'Researcher', url: '/agent/agent-1/topic-1' }],
        pinned: [],
        recent: [{ subtitle: 'Researcher', title: 'Research', url: '/agent/agent-1/topic-1' }],
      }),
    );
    expect(mocks.useFetchAgentList).toHaveBeenCalled();
    const calls = mocks.updateNavigationSnapshot.mock.calls.length;

    rerender();
    expect(mocks.updateNavigationSnapshot).toHaveBeenCalledTimes(calls);
  });

  it('refetches the recents when the active topics change', async () => {
    const getAll = vi.spyOn(recentService, 'getAll').mockResolvedValue([]);
    const { rerender } = renderHook(() => useTrayMenuSync(), { wrapper });
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(1));

    mocks.activeTopics = [{ status: 'running', topicId: 'topic-2' }];
    getAll.mockResolvedValueOnce([topic('topic-1', 'Running now')]);
    rerender();

    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(lastSnapshot()?.recent?.map((row: { title: string }) => row.title)).toContain(
        'Running now',
      ),
    );
  });

  it('does not fetch while logged out', async () => {
    mocks.isLogin = false;
    const getAll = vi.spyOn(recentService, 'getAll');

    renderHook(() => useTrayMenuSync(), { wrapper });

    await waitFor(() => expect(mocks.updateNavigationSnapshot).toHaveBeenCalled());
    expect(getAll).not.toHaveBeenCalled();
  });

  it('logs synchronization failures without throwing into the titlebar', async () => {
    vi.spyOn(recentService, 'getAll').mockResolvedValue([]);
    const error = new Error('IPC unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.updateNavigationSnapshot.mockRejectedValue(error);

    expect(() => renderHook(() => useTrayMenuSync(), { wrapper })).not.toThrow();
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('Failed to synchronize tray menu:', error),
    );
  });
});
