import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PERSONAL_TAB_SCOPE, type TabScope } from '@/features/Electron/titlebar/TabBar/scope';
import { getTabPages } from '@/features/Electron/titlebar/TabBar/storage';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

const tab = (id: string, url: string, patch: Partial<TabItem> = {}): TabItem => ({
  id,
  lastVisited: 1,
  url,
  ...patch,
});

const home = tab('home', '/');
const goal = tab('goal', '/agent/a1/goal/g1', { cached: { title: 'Ship the launch post' } });
const topic = tab('topic', '/agent/a1?topic=t1');
const page = tab('page', '/page/p1');

const seed = (
  tabs: TabItem[],
  activeTabId: string,
  activeTabScope: TabScope = PERSONAL_TAB_SCOPE,
) => {
  const { result } = renderHook(() => useElectronStore());
  act(() => {
    useElectronStore.setState({ activeTabId, activeTabScope, tabs });
  });
  return result;
};

const urls = (tabs: TabItem[]) => tabs.map((item) => item.url);

describe('reopenClosedTab', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useElectronStore.setState({
      ...initialState,
      activeTabId: null,
      closedTabBuckets: {},
      splitView: null,
      tabs: [],
    });
  });

  it('does nothing when no tab was closed', () => {
    const result = seed([home, goal], 'goal');

    let returned: string | null = 'unset';
    act(() => {
      returned = result.current.reopenClosedTab();
    });

    expect(returned).toBeNull();
    expect(urls(result.current.tabs)).toEqual(['/', '/agent/a1/goal/g1']);
  });

  it('restores the closed tab at its old position with its title, and focuses it', () => {
    const result = seed([home, goal, topic], 'topic');

    act(() => {
      result.current.removeTab('goal');
    });
    expect(urls(result.current.tabs)).toEqual(['/', '/agent/a1?topic=t1']);

    act(() => {
      result.current.reopenClosedTab();
    });

    const { activeTabId, tabs } = result.current;
    expect(urls(tabs)).toEqual(['/', '/agent/a1/goal/g1', '/agent/a1?topic=t1']);
    expect(tabs[1].cached?.title).toBe('Ship the launch post');
    expect(activeTabId).toBe(tabs[1].id);
    expect(getTabPages(PERSONAL_TAB_SCOPE).tabs.map((item) => item.url)).toEqual(urls(tabs));
  });

  it('reopens tabs in reverse close order, one close at a time', () => {
    const result = seed([home, goal, topic, page], 'home');

    act(() => {
      result.current.removeTab('goal');
      result.current.removeTab('page');
    });

    act(() => {
      result.current.reopenClosedTab();
    });
    expect(urls(result.current.tabs)).toEqual(['/', '/agent/a1?topic=t1', '/page/p1']);

    act(() => {
      result.current.reopenClosedTab();
    });
    expect(urls(result.current.tabs)).toEqual([
      '/',
      '/agent/a1/goal/g1',
      '/agent/a1?topic=t1',
      '/page/p1',
    ]);

    let returned: string | null = 'unset';
    act(() => {
      returned = result.current.reopenClosedTab();
    });
    expect(returned).toBeNull();
  });

  // addNewTab deliberately allows two tabs on the same page, so one bulk close can take
  // both; a tab restored earlier in the same reopen must not count as "already open".
  it('counts an open tab on that page once, restoring the other copy', () => {
    const secondHome = tab('home-2', '/');
    const result = seed([home, secondHome, goal], 'goal');

    act(() => {
      result.current.closeOtherTabs('goal');
    });
    act(() => {
      result.current.addNewTab('/');
    });
    expect(urls(result.current.tabs)).toEqual(['/agent/a1/goal/g1', '/']);

    act(() => {
      result.current.reopenClosedTab();
    });

    expect(urls(result.current.tabs).filter((url) => url === '/')).toHaveLength(2);
    expect(result.current.tabs).toHaveLength(3);
  });

  it('brings back every tab of a bulk close, even two on the same page', () => {
    const secondHome = tab('home-2', '/');
    const result = seed([home, secondHome, goal], 'goal');

    act(() => {
      result.current.closeOtherTabs('goal');
    });
    expect(urls(result.current.tabs)).toEqual(['/agent/a1/goal/g1']);

    act(() => {
      result.current.reopenClosedTab();
    });

    expect(urls(result.current.tabs)).toEqual(['/', '/', '/agent/a1/goal/g1']);
  });

  it('brings back every tab a bulk close took, focusing the tab that was active', () => {
    const result = seed([home, goal, topic, page], 'page');

    act(() => {
      result.current.closeOtherTabs('topic');
    });
    expect(urls(result.current.tabs)).toEqual(['/agent/a1?topic=t1']);

    act(() => {
      result.current.reopenClosedTab();
    });

    const { activeTabId, tabs } = result.current;
    expect(urls(tabs)).toEqual(['/', '/agent/a1/goal/g1', '/agent/a1?topic=t1', '/page/p1']);
    expect(tabs.find((item) => item.id === activeTabId)?.url).toBe('/page/p1');
  });

  it('keeps a reopened pinned tab inside the pinned run', () => {
    const pinnedGoal = { ...goal, pinned: true };
    const result = seed([pinnedGoal, home, topic], 'home');

    act(() => {
      result.current.removeTab('goal');
    });
    act(() => {
      result.current.reopenClosedTab();
    });

    const { tabs } = result.current;
    expect(urls(tabs)).toEqual(['/agent/a1/goal/g1', '/', '/agent/a1?topic=t1']);
    expect(tabs[0].pinned).toBe(true);
  });

  it('switches to the page instead of duplicating it when it is already open again', () => {
    const result = seed([home, goal], 'home');

    act(() => {
      result.current.removeTab('goal');
      result.current.addTab('/agent/a1/goal/g1', undefined, false);
    });
    const reopenedId = result.current.tabs[1].id;

    act(() => {
      result.current.reopenClosedTab();
    });

    expect(urls(result.current.tabs)).toEqual(['/', '/agent/a1/goal/g1']);
    expect(result.current.activeTabId).toBe(reopenedId);
  });

  it('does not record the copy a self-split made', () => {
    const result = seed([home, goal], 'goal');

    let copyId: string | null = null;
    act(() => {
      copyId = result.current.openTabInSplitView('goal');
    });
    act(() => {
      result.current.removeTab(copyId!);
    });

    expect(result.current.closedTabBuckets).toEqual({});
  });

  it('does not record a lone home tab replaced by a fresh home tab', () => {
    const result = seed([home], 'home');

    act(() => {
      result.current.removeTab('home');
    });

    expect(result.current.closedTabBuckets).toEqual({});
  });

  // Closing the last tab leaves a generated home tab so TabHost has something to render;
  // undoing that close should not leave that placeholder behind as an extra tab.
  it('replaces the untouched home tab that closing the last tab left behind', () => {
    const result = seed([goal], 'goal');

    act(() => {
      result.current.removeTab('goal');
    });
    expect(urls(result.current.tabs)).toEqual(['/']);

    act(() => {
      result.current.reopenClosedTab();
    });

    const { activeTabId, tabs } = result.current;
    expect(urls(tabs)).toEqual(['/agent/a1/goal/g1']);
    expect(activeTabId).toBe(tabs[0].id);
  });

  it('keeps that home tab once the user navigated it', () => {
    const result = seed([goal], 'goal');

    act(() => {
      result.current.removeTab('goal');
    });
    act(() => {
      result.current.updateTab(result.current.tabs[0].id, '/page/p1');
    });
    act(() => {
      result.current.reopenClosedTab();
    });

    expect(urls(result.current.tabs)).toEqual(['/agent/a1/goal/g1', '/page/p1']);
  });

  it('keeps that home tab once the user opened another tab beside it', () => {
    const result = seed([goal], 'goal');

    act(() => {
      result.current.removeTab('goal');
    });
    act(() => {
      result.current.addTab('/page/p1');
    });
    act(() => {
      result.current.reopenClosedTab();
    });

    expect(urls(result.current.tabs)).toEqual(['/agent/a1/goal/g1', '/', '/page/p1']);
  });

  it('keeps closed tabs per scope', () => {
    const result = seed([home, goal], 'goal');

    act(() => {
      result.current.removeTab('goal');
      result.current.loadTabs('/acme');
    });

    let returned: string | null = 'unset';
    act(() => {
      returned = result.current.reopenClosedTab();
    });
    expect(returned).toBeNull();

    act(() => {
      result.current.loadTabs('/');
      result.current.reopenClosedTab();
    });
    expect(urls(result.current.tabs)).toContain('/agent/a1/goal/g1');
  });
});
