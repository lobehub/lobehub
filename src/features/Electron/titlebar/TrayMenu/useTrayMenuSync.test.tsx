import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTrayMenuSync } from './useTrayMenuSync';

const mocks = vi.hoisted(() => ({
  agents: [{ id: 'agent-1', title: 'Researcher', updatedAt: '2026-07-11T00:00:00.000Z' }],
  useFetchAgentList: vi.fn(),
  updateNavigationSnapshot: vi.fn(),
}));

vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: mocks.useFetchAgentList }));

vi.mock('@/services/electron/tray', () => ({
  desktopTrayService: { updateNavigationSnapshot: mocks.updateNavigationSnapshot },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: vi.fn(() => mocks.agents),
}));

vi.mock('@/store/home/slices/agentList/selectors', () => ({
  homeAgentListSelectors: { allAgents: vi.fn() },
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

describe('useTrayMenuSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateNavigationSnapshot.mockResolvedValue({ success: true });
  });

  it('pushes resolved navigation data and does not resend an identical render', async () => {
    const { rerender } = renderHook(() => useTrayMenuSync());

    await waitFor(() => expect(mocks.updateNavigationSnapshot).toHaveBeenCalledTimes(1));
    expect(mocks.useFetchAgentList).toHaveBeenCalled();
    expect(mocks.updateNavigationSnapshot).toHaveBeenCalledWith({
      agents: [{ id: 'agent-1', title: 'Researcher', url: '/agent/agent-1/topic-1' }],
      pinned: [],
      recent: [{ subtitle: 'Researcher', title: 'Research', url: '/agent/agent-1/topic-1' }],
    });

    rerender();
    expect(mocks.updateNavigationSnapshot).toHaveBeenCalledTimes(1);
  });

  it('logs synchronization failures without throwing into the titlebar', async () => {
    const error = new Error('IPC unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.updateNavigationSnapshot.mockRejectedValue(error);

    expect(() => renderHook(() => useTrayMenuSync())).not.toThrow();
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('Failed to synchronize tray menu:', error),
    );

    consoleError.mockRestore();
  });
});
