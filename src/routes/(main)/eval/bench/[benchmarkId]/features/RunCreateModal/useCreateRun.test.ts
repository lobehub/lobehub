import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreateRun } from './useCreateRun';

const navigate = vi.fn();
const createRunCreateModal = vi.fn();
let lobeBench = false;

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/features/LobeBench/useIsLobeBenchBenchmark', () => ({
  useIsLobeBenchBenchmark: () => lobeBench,
}));
vi.mock('./index', () => ({
  createRunCreateModal: (props: unknown) => createRunCreateModal(props),
}));
vi.mock('@/store/eval', () => {
  const state = {
    datasetListMap: { bm_1: [{ id: 'ds_first' }, { id: 'ds_second' }] },
    useFetchBenchmarkDetail: () => ({}),
  };
  return {
    datasetSelectors: {
      datasetList: (id?: string) => (s: typeof state) =>
        (id ? (s.datasetListMap as Record<string, { id: string }[]>)[id] : undefined) ?? [],
    },
    useEvalStore: (selector: (s: typeof state) => unknown) => selector(state),
  };
});

describe('useCreateRun', () => {
  beforeEach(() => {
    navigate.mockReset();
    createRunCreateModal.mockReset();
  });

  it('opens the Lab run modal for a Lab benchmark', () => {
    lobeBench = false;
    const { result } = renderHook(() => useCreateRun('bm_1'));

    act(() => result.current.createRun({ id: 'ds_second', name: 'Second' }));

    expect(createRunCreateModal).toHaveBeenCalledWith({
      benchmarkId: 'bm_1',
      datasetId: 'ds_second',
      datasetName: 'Second',
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  // Lobe Bench runs open on the Lab pages; their "new run" buttons used to open
  // the Lab's single-agent modal, a second, different way to start an experiment.
  it('sends a Lobe Bench benchmark to the new experiment page on the dataset', () => {
    lobeBench = true;
    const { result } = renderHook(() => useCreateRun('bm_1'));

    act(() => result.current.createRun({ id: 'ds_second', name: 'Second' }));

    expect(navigate).toHaveBeenCalledWith('/eval/lobe-bench/experiments/new?dataset=ds_second');
    expect(createRunCreateModal).not.toHaveBeenCalled();
    expect(result.current.lobeBench).toBe(true);
  });

  it('uses the benchmark first dataset when the button names none', () => {
    lobeBench = true;
    const { result } = renderHook(() => useCreateRun('bm_1'));

    act(() => result.current.createRun());

    expect(navigate).toHaveBeenCalledWith('/eval/lobe-bench/experiments/new?dataset=ds_first');
  });
});
