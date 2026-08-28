import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PERSONAL_TAB_SCOPE } from '@/features/Electron/titlebar/TabBar/scope';
import { saveTabPages } from '@/features/Electron/titlebar/TabBar/storage';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

import { useSeedTabsOnBoot } from './useSeedTabsOnBoot';

const activeUrl = () => {
  const { activeTabId, tabs } = useElectronStore.getState();
  return tabs.find((tab) => tab.id === activeTabId)?.url ?? null;
};

beforeEach(() => {
  window.localStorage.clear();
  useElectronStore.setState({ ...initialState });
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useSeedTabsOnBoot', () => {
  it('keeps the anchor of a direct launch url so the deep link survives boot', () => {
    window.history.replaceState(null, '', '/agent/a?q=1#msg_1');

    renderHook(() => useSeedTabsOnBoot());

    expect(activeUrl()).toBe('/agent/a?q=1#msg_1');
  });

  it('moves a matching persisted tab to the launch anchor', () => {
    saveTabPages(PERSONAL_TAB_SCOPE, [{ id: 'a', lastVisited: 1, url: '/agent/a' }], null);
    window.history.replaceState(null, '', '/agent/a#msg_2');

    renderHook(() => useSeedTabsOnBoot());

    expect(useElectronStore.getState().tabs).toHaveLength(1);
    expect(activeUrl()).toBe('/agent/a#msg_2');
  });

  it('restores the persisted session on a cold start carrying the main-process locale param', () => {
    saveTabPages(PERSONAL_TAB_SCOPE, [{ id: 'a', lastVisited: 1, url: '/agent/a' }], 'a');
    window.history.replaceState(null, '', '/?lng=zh-CN');

    renderHook(() => useSeedTabsOnBoot());

    expect(useElectronStore.getState().tabs).toHaveLength(1);
    expect(useElectronStore.getState().activeTabId).toBe('a');
  });

  it('matches a persisted tab on a deep link whose query also carries the locale param', () => {
    saveTabPages(PERSONAL_TAB_SCOPE, [{ id: 'a', lastVisited: 1, url: '/agent/a?topic=t1' }], null);
    window.history.replaceState(null, '', '/agent/a?topic=t1&lng=zh-CN');

    renderHook(() => useSeedTabsOnBoot());

    expect(useElectronStore.getState().tabs).toHaveLength(1);
    expect(activeUrl()).toBe('/agent/a?topic=t1');
  });

  it('activates a persisted tab instead of adding one when the boot url matches', () => {
    saveTabPages(PERSONAL_TAB_SCOPE, [{ id: 'a', lastVisited: 1, url: '/agent/a' }], null);
    window.history.replaceState(null, '', '/agent/a');

    renderHook(() => useSeedTabsOnBoot());

    expect(useElectronStore.getState().tabs).toHaveLength(1);
    expect(useElectronStore.getState().activeTabId).toBe('a');
  });
});
