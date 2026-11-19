import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDisplayedTabStore } from '@/features/Electron/TabHost/displayedTab';
import { useElectronStore } from '@/store/electron';

import { useActiveNavKey } from './useActiveNavKey.desktop';

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));

const tab = (id: string, url: string) => ({ id, lastVisited: 0, url });

afterEach(() => {
  useElectronStore.setState({ activeTabId: null, tabs: [] });
  useDisplayedTabStore.setState({ tabId: null });
});

describe('useActiveNavKey (desktop)', () => {
  it('keeps the panel of the tab on screen until the clicked tab is revealed', () => {
    useElectronStore.setState({
      activeTabId: 'topic',
      tabs: [tab('home', '/'), tab('topic', '/agent/agt_a/tpc_a')],
    });
    useDisplayedTabStore.setState({ tabId: 'home' });

    const { result } = renderHook(() => useActiveNavKey());
    expect(result.current).toBe('home');

    act(() => useDisplayedTabStore.setState({ tabId: 'topic' }));
    expect(result.current).toBe('agent');
  });

  it('follows in-tab navigation of the displayed tab', () => {
    useElectronStore.setState({ activeTabId: 'only', tabs: [tab('only', '/')] });
    useDisplayedTabStore.setState({ tabId: 'only' });

    const { result } = renderHook(() => useActiveNavKey());
    act(() => useElectronStore.getState().reportTabLocation('only', '/agent/agt_a?thread=x'));

    expect(result.current).toBe('agent');
  });

  it('falls back to the active tab before any tab is displayed', () => {
    useElectronStore.setState({ activeTabId: 'only', tabs: [tab('only', '/community')] });

    const { result } = renderHook(() => useActiveNavKey());

    expect(result.current).toBe('discover');
  });
});
