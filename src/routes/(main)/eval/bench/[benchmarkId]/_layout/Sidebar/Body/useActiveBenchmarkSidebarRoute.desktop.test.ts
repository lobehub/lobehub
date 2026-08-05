import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { useActiveBenchmarkSidebarRoute } from './useActiveBenchmarkSidebarRoute';

const evalStore = vi.hoisted(() => ({
  useFetchDatasets: vi.fn(),
  useFetchRuns: vi.fn(),
}));

vi.mock('@/hooks/useActiveLocation', async () => await import('@/hooks/useActiveLocation.desktop'));
vi.mock(
  '@/hooks/useActiveRouteParams',
  async () => await import('@/hooks/useActiveRouteParams.desktop'),
);
vi.mock('@/store/eval', () => ({
  useEvalStore: (selector: (state: typeof evalStore) => unknown) => selector(evalStore),
}));

const tab = (url: string) => ({ id: 'benchmark-tab', lastVisited: 0, url });

afterEach(() => {
  useElectronStore.setState({ activeTabId: null, tabs: [] });
  vi.clearAllMocks();
});

describe('useActiveBenchmarkSidebarRoute (desktop)', () => {
  it('updates the benchmark target and active item when the active tab changes IDs', () => {
    useElectronStore.setState({
      activeTabId: 'benchmark-tab',
      tabs: [tab('/eval/bench/benchmark-a/datasets/dataset-a')],
    });

    const { result } = renderHook(() => useActiveBenchmarkSidebarRoute());
    expect(result.current).toEqual({
      activeKey: 'dataset-dataset-a',
      benchmarkId: 'benchmark-a',
    });
    expect(evalStore.useFetchDatasets).toHaveBeenLastCalledWith('benchmark-a');
    expect(evalStore.useFetchRuns).toHaveBeenLastCalledWith('benchmark-a');

    act(() => {
      useElectronStore.setState({
        tabs: [tab('/eval/bench/benchmark-b/runs/run-b')],
      });
    });

    expect(result.current).toEqual({ activeKey: 'run-run-b', benchmarkId: 'benchmark-b' });
    expect(evalStore.useFetchDatasets).toHaveBeenLastCalledWith('benchmark-b');
    expect(evalStore.useFetchRuns).toHaveBeenLastCalledWith('benchmark-b');
  });
});
