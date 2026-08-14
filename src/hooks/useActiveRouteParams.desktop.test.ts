import { act, renderHook } from '@testing-library/react';
import type * as ReactRouter from 'react-router';
import { matchRoutes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { useActiveRouteParams } from './useActiveRouteParams.desktop';

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, matchRoutes: vi.fn(actual.matchRoutes) };
});

const matchRoutesSpy = vi.mocked(matchRoutes);
const tab = (id: string, url: string) => ({ id, lastVisited: 0, url });

afterEach(() => {
  useElectronStore.setState({ activeTabId: null, tabs: [] });
  matchRoutesSpy.mockClear();
});

describe('useActiveRouteParams (desktop)', () => {
  it('matches the active tab url once no matter how many consumers read it', () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/agent/agt_many_consumers')],
    });
    matchRoutesSpy.mockClear();

    const consumers = Array.from({ length: 5 }, () => renderHook(() => useActiveRouteParams()));

    expect(matchRoutesSpy).toHaveBeenCalledTimes(1);
    expect(consumers.every((c) => c.result.current === consumers[0].result.current)).toBe(true);
  });

  it('matches once more when the active tab url changes, not once per consumer', () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/agent/agt_before_switch')],
    });
    const consumers = Array.from({ length: 4 }, () => renderHook(() => useActiveRouteParams()));
    matchRoutesSpy.mockClear();

    act(() => {
      useElectronStore.setState({ tabs: [tab('t1', '/agent/agt_after_switch')] });
    });

    expect(matchRoutesSpy).toHaveBeenCalledTimes(1);
    expect(consumers.every((c) => c.result.current === consumers[0].result.current)).toBe(true);
  });

  it('resolves the params of the active tab url', () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/agent/agt_params_case')],
    });

    const { result } = renderHook(() => useActiveRouteParams<{ aid?: string }>());

    expect(result.current.aid).toBe('agt_params_case');
  });

  it('resolves project params for portal sidebars', () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/project/prj_portal/tasks')],
    });

    const { result } = renderHook(() => useActiveRouteParams<{ projectId?: string }>());

    expect(result.current.projectId).toBe('prj_portal');
  });

  it('re-resolves after switching back to a previously visited url', () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/agent/agt_round_trip_a')],
    });
    const { result } = renderHook(() => useActiveRouteParams<{ aid?: string }>());
    expect(result.current.aid).toBe('agt_round_trip_a');

    act(() => {
      useElectronStore.setState({ tabs: [tab('t1', '/agent/agt_round_trip_b')] });
    });
    expect(result.current.aid).toBe('agt_round_trip_b');

    act(() => {
      useElectronStore.setState({ tabs: [tab('t1', '/agent/agt_round_trip_a')] });
    });
    expect(result.current.aid).toBe('agt_round_trip_a');
  });
});
