import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { useWindowUrlMirror } from './useWindowUrlMirror';

const tab = (id: string, url: string) => ({ id, lastVisited: 0, url });

let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  useElectronStore.setState({ activeTabId: null, tabs: [] });
});

describe('useWindowUrlMirror', () => {
  it('mirrors the active tab url on mount and on tab switch', () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/agent/a'), tab('t2', '/settings')],
    });

    renderHook(() => useWindowUrlMirror());
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/agent/a');

    act(() => useElectronStore.setState({ activeTabId: 't2' }));
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/settings');
  });

  it('reflects in-tab navigation (active tab url change)', () => {
    useElectronStore.setState({ activeTabId: 't1', tabs: [tab('t1', '/agent/a')] });

    renderHook(() => useWindowUrlMirror());
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/agent/a');

    act(() => useElectronStore.setState({ tabs: [tab('t1', '/agent/a/topic/1')] }));
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/agent/a/topic/1');
  });

  it('never mirrors a falsy url', () => {
    useElectronStore.setState({ activeTabId: null, tabs: [] });

    renderHook(() => useWindowUrlMirror());

    expect(replaceState).not.toHaveBeenCalled();
  });
});
