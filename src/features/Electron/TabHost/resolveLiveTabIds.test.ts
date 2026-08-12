import { describe, expect, it } from 'vitest';

import { MAX_LIVE_TAB_ROUTERS, resolveLiveTabIds } from './resolveLiveTabIds';

type Tab = { id: string; lastVisited: number };

const tab = (id: string, lastVisited: number): Tab => ({ id, lastVisited });

describe('resolveLiveTabIds', () => {
  it('returns every id when the cap exceeds the tab count', () => {
    const tabs = [tab('a', 1), tab('b', 2), tab('c', 3)];

    expect(resolveLiveTabIds(tabs, 'a', 10)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the active tab plus the most recently visited and evicts the oldest', () => {
    const tabs = [tab('a', 1), tab('b', 2), tab('c', 3), tab('d', 4)];

    expect(resolveLiveTabIds(tabs, 'a', 2)).toEqual(['a', 'd']);
  });

  it('always keeps the active tab even when it is the oldest, evicting the next-oldest instead', () => {
    const tabs = [tab('a', 1), tab('b', 2), tab('c', 3)];

    expect(resolveLiveTabIds(tabs, 'a', 2)).toEqual(['a', 'c']);
  });

  it('breaks ties on equal lastVisited by stable input order', () => {
    const tabs = [tab('a', 5), tab('b', 5), tab('c', 5)];

    expect(resolveLiveTabIds(tabs, null, 2)).toEqual(['a', 'b']);
  });

  it('falls back to the most recent cap tabs when there is no active tab', () => {
    const tabs = [tab('a', 1), tab('b', 2), tab('c', 3), tab('d', 4)];

    expect(resolveLiveTabIds(tabs, null, 2)).toEqual(['c', 'd']);
  });

  it('handles degenerate inputs safely', () => {
    expect(resolveLiveTabIds([], 'a', 5)).toEqual([]);
    expect(resolveLiveTabIds([tab('a', 1), tab('b', 2)], 'a', 0)).toEqual(['a']);
    expect(resolveLiveTabIds([tab('a', 1)], null, 0)).toEqual([]);
  });

  it('retains both visible split panes even when one is older than the LRU cap', () => {
    const tabs = [tab('left', 1), tab('recent', 3), tab('right', 2)];

    expect(resolveLiveTabIds(tabs, 'right', 2, ['left', 'right'])).toEqual(['left', 'right']);
  });

  it('exposes the default cap', () => {
    expect(MAX_LIVE_TAB_ROUTERS).toBe(3);
  });
});
