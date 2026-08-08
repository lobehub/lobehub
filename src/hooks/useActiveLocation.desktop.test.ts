import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { useActiveLocation } from './useActiveLocation.desktop';

const tab = (id: string, url: string) => ({ id, lastVisited: 0, url });

afterEach(() => {
  useElectronStore.setState({ activeTabId: null, tabs: [] });
});

describe('useActiveLocation (desktop)', () => {
  it('derives pathname/search from the active tab url and drops any hash', () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/agent/a?topic=x#frag'), tab('t2', '/settings')],
    });

    const { result } = renderHook(() => useActiveLocation());

    expect(result.current.pathname).toBe('/agent/a');
    expect(result.current.search).toBe('?topic=x');
    expect(result.current.hash).toBe('');
  });

  it('updates when the active tab switches', () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/agent/a'), tab('t2', '/settings/general')],
    });

    const { result } = renderHook(() => useActiveLocation());
    expect(result.current.pathname).toBe('/agent/a');

    act(() => useElectronStore.setState({ activeTabId: 't2' }));

    expect(result.current.pathname).toBe('/settings/general');
  });

  it('falls back to "/" when there is no active tab', () => {
    useElectronStore.setState({ activeTabId: null, tabs: [] });

    const { result } = renderHook(() => useActiveLocation());

    expect(result.current.pathname).toBe('/');
    expect(result.current.search).toBe('');
  });
});
