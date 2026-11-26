import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useExperimentActions } from './useExperimentActions';

const service = vi.hoisted(() => ({
  abortRun: vi.fn(),
  rerunRunUnverified: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/services/agentEval', () => ({ agentEvalService: service }));
vi.mock('@lobehub/ui', () => ({ toast }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: unknown) => `${key}:${JSON.stringify(values)}`,
  }),
}));

const options = () => ({
  experimentId: 'experiment',
  onRerunStarted: vi.fn(),
  refreshResults: vi.fn().mockResolvedValue(undefined),
  refreshRuns: vi.fn().mockResolvedValue(undefined),
  targets: [
    { runId: 'a', name: 'Model A', status: 'completed', unverified: 2 },
    { runId: 'b', name: 'Model B', status: 'completed', unverified: 1 },
  ],
});

describe('useExperimentActions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('offers a rerun only for finished runs with an attempt without a verdict', async () => {
    const props = options();
    props.targets = [
      { runId: 'a', name: 'Model A', status: 'completed', unverified: 0 },
      { runId: 'b', name: 'Model B', status: 'running', unverified: 3 },
    ];
    const { result } = renderHook(() => useExperimentActions(props));
    expect(result.current.canRerun).toBe(false);
    expect(result.current.rerunCases).toBe(0);
    await act(() => result.current.rerun());
    expect(service.rerunRunUnverified).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('counts the cases a rerun covers and reports per-run outcomes', async () => {
    const props = options();
    props.refreshRuns.mockRejectedValue(new Error('Refresh unavailable'));
    service.rerunRunUnverified.mockImplementation((id: string) =>
      id === 'a'
        ? Promise.resolve({ rerunCount: 2, runId: 'a', success: true })
        : Promise.reject(new Error('Dispatch unavailable')),
    );
    const { result } = renderHook(() => useExperimentActions(props));
    expect(result.current.rerunCases).toBe(3);
    await act(() => result.current.rerun());
    expect(service.rerunRunUnverified.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    // SWR mutate(undefined) writes to the cache; revalidation must receive no arguments.
    expect(props.refreshRuns).toHaveBeenCalledTimes(1);
    expect(props.refreshRuns.mock.calls[0]).toEqual([]);
    expect(props.refreshResults).toHaveBeenCalledTimes(1);
    expect(props.refreshResults.mock.calls[0]).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Model A'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('"count":2'));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('action.rerunFailed'));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Model B'));
    expect(props.onRerunStarted).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it('does not start polling when nothing was dispatched', async () => {
    const props = options();
    service.rerunRunUnverified.mockRejectedValue(new Error('Dispatch unavailable'));
    const { result } = renderHook(() => useExperimentActions(props));
    await act(() => result.current.rerun());
    expect(props.onRerunStarted).not.toHaveBeenCalled();
    expect(props.refreshRuns).toHaveBeenCalledTimes(1);
    expect(props.refreshResults).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('tells a run that is still running apart from other failures', async () => {
    const props = options();
    service.rerunRunUnverified.mockImplementation((id: string) =>
      id === 'a'
        ? Promise.reject(new Error('Cannot rerun a running run'))
        : Promise.resolve({ rerunCount: 1, runId: 'b', success: true }),
    );
    const { result } = renderHook(() => useExperimentActions(props));
    await act(() => result.current.rerun());
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('action.stillRunning'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Model B'));
  });

  it('shares one busy guard across rerun and stop, including same-tick clicks', async () => {
    let finish!: (value: { rerunCount: number }) => void;
    service.rerunRunUnverified.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(() => useExperimentActions(options()));
    let request!: Promise<void>;
    act(() => {
      request = result.current.rerun();
      void result.current.stop();
      void result.current.rerun();
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.pendingAction).toBe('rerun');
    expect(service.rerunRunUnverified).toHaveBeenCalledTimes(2);
    expect(service.abortRun).not.toHaveBeenCalled();
    await act(async () => {
      finish({ rerunCount: 1 });
      await request;
    });
    expect(result.current.busy).toBe(false);
  });

  it('refreshes both datasets when stopping a batch partially fails', async () => {
    const props = options();
    props.targets = props.targets.map((target) => ({ ...target, status: 'running' }));
    service.abortRun.mockImplementation((id: string) =>
      id === 'a'
        ? Promise.resolve({ success: true })
        : Promise.reject(new Error('Stop unavailable')),
    );
    const { result } = renderHook(() => useExperimentActions(props));
    expect(result.current.canRerun).toBe(false);
    await act(() => result.current.stop());
    expect(props.refreshRuns).toHaveBeenCalledTimes(1);
    expect(props.refreshResults).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Model A'));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Model B'));
  });

  it('ignores a response that arrives after switching to another experiment', async () => {
    const props = options();
    let finish!: (value: { rerunCount: number }) => void;
    service.rerunRunUnverified.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, rerender } = renderHook((value) => useExperimentActions(value), {
      initialProps: props,
    });
    let request!: Promise<void>;
    act(() => {
      request = result.current.rerun();
    });
    rerender({ ...props, experimentId: 'another-experiment' });
    await act(async () => {
      finish({ rerunCount: 1 });
      await request;
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(props.onRerunStarted).not.toHaveBeenCalled();
  });
});
