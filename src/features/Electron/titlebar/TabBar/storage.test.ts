import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getTabPages,
  saveTabPages,
  TAB_PAGES_STORAGE_KEY,
  TAB_PAGES_STORAGE_KEY_V1,
} from './storage';

describe('TabBar storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns empty when nothing is stored', () => {
    expect(getTabPages()).toEqual({ activeTabId: null, tabs: [] });
  });

  it('round-trips v2 tab items', () => {
    saveTabPages([{ id: '/agent/abc', lastVisited: 1, url: '/agent/abc' }], '/agent/abc');
    const loaded = getTabPages();
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.tabs[0].url).toBe('/agent/abc');
    expect(loaded.activeTabId).toBe('/agent/abc');
  });

  describe('v1 -> v2 migration', () => {
    it('reconstructs urls from old type + params', () => {
      window.localStorage.setItem(
        TAB_PAGES_STORAGE_KEY_V1,
        JSON.stringify({
          activeTabId: 'agent:abc',
          tabs: [
            {
              cached: { avatar: 'a.png', title: 'Claude' },
              id: 'agent:abc',
              lastVisited: 10,
              params: { agentId: 'abc' },
              type: 'agent',
            },
            {
              id: 'agent-topic:abc:tpc_1',
              lastVisited: 20,
              params: { agentId: 'abc', topicId: 'tpc_1' },
              type: 'agent-topic',
            },
            {
              id: 'home',
              lastVisited: 5,
              params: {},
              type: 'home',
            },
          ],
        }),
      );

      const migrated = getTabPages();
      expect(migrated.tabs.map((t) => t.url)).toEqual(['/agent/abc', '/agent/abc/tpc_1', '/']);
      expect(migrated.activeTabId).toBe('/agent/abc');
      expect(migrated.tabs[0].cached).toEqual({ avatar: 'a.png', title: 'Claude' });
    });

    it('drops tabs whose url cannot be reconstructed', () => {
      window.localStorage.setItem(
        TAB_PAGES_STORAGE_KEY_V1,
        JSON.stringify({
          activeTabId: null,
          tabs: [
            { id: 'agent:', lastVisited: 1, params: {}, type: 'agent' },
            { id: 'mystery', lastVisited: 1, params: {}, type: 'unknown-type' },
            { id: 'home', lastVisited: 1, params: {}, type: 'home' },
          ],
        }),
      );

      const migrated = getTabPages();
      expect(migrated.tabs).toHaveLength(1);
      expect(migrated.tabs[0].url).toBe('/');
    });

    it('removes the v1 key after migration', () => {
      window.localStorage.setItem(
        TAB_PAGES_STORAGE_KEY_V1,
        JSON.stringify({ activeTabId: null, tabs: [] }),
      );
      getTabPages();
      expect(window.localStorage.getItem(TAB_PAGES_STORAGE_KEY_V1)).toBeNull();
    });

    it('does not migrate when v2 data already exists', () => {
      window.localStorage.setItem(
        TAB_PAGES_STORAGE_KEY,
        JSON.stringify({
          activeTabId: '/page/p1',
          tabs: [{ id: '/page/p1', lastVisited: 1, url: '/page/p1' }],
        }),
      );
      window.localStorage.setItem(
        TAB_PAGES_STORAGE_KEY_V1,
        JSON.stringify({
          activeTabId: 'agent:abc',
          tabs: [{ id: 'agent:abc', lastVisited: 1, params: { agentId: 'abc' }, type: 'agent' }],
        }),
      );

      const loaded = getTabPages();
      expect(loaded.tabs).toHaveLength(1);
      expect(loaded.tabs[0].url).toBe('/page/p1');
    });
  });
});
