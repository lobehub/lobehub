import { act, render } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { useActiveBenchmarkSidebarRoute } from './useActiveBenchmarkSidebarRoute';

const evalStore = vi.hoisted(() => ({
  useFetchDatasets: vi.fn(),
  useFetchRuns: vi.fn(),
}));

vi.mock('@/store/eval', () => ({
  useEvalStore: (selector: (state: typeof evalStore) => unknown) => selector(evalStore),
}));

describe('useActiveBenchmarkSidebarRoute (desktop)', () => {
  it('updates the benchmark target and active item when route IDs change', async () => {
    let value: ReturnType<typeof useActiveBenchmarkSidebarRoute> | undefined;
    const Probe = () => {
      value = useActiveBenchmarkSidebarRoute();
      return null;
    };
    const router = createMemoryRouter(
      [{ element: React.createElement(Probe), path: '/eval/bench/:benchmarkId/*' }],
      { initialEntries: ['/eval/bench/benchmark-a/datasets/dataset-a'] },
    );

    render(React.createElement(RouterProvider, { router }));
    expect(value).toEqual({
      activeKey: 'dataset-dataset-a',
      benchmarkId: 'benchmark-a',
    });
    expect(evalStore.useFetchDatasets).toHaveBeenLastCalledWith('benchmark-a');
    expect(evalStore.useFetchRuns).toHaveBeenLastCalledWith('benchmark-a');

    await act(() => router.navigate('/eval/bench/benchmark-b/runs/run-b'));

    expect(value).toEqual({ activeKey: 'run-run-b', benchmarkId: 'benchmark-b' });
    expect(evalStore.useFetchDatasets).toHaveBeenLastCalledWith('benchmark-b');
    expect(evalStore.useFetchRuns).toHaveBeenLastCalledWith('benchmark-b');
  });
});
