import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerLocalBackgroundTaskStopper } from '@/store/chat/slices/agentRun/actions/transports/hetero/backgroundTasks';

import { STOP_PENDING_RESET_MS, useStopBackgroundTask } from './useStopBackgroundTask';

const stopHeteroBackgroundTask = vi.hoisted(() => vi.fn());
vi.mock('@/services/aiAgent', () => ({ aiAgentService: { stopHeteroBackgroundTask } }));

const setup = (props: Partial<Parameters<typeof useStopBackgroundTask>[0]> = {}) => {
  const onFailure = vi.fn();
  const hook = renderHook(
    (p: Parameters<typeof useStopBackgroundTask>[0]) => useStopBackgroundTask(p),
    {
      initialProps: {
        onFailure,
        operationId: 'op-1',
        route: 'server',
        running: true,
        taskId: 'b1',
        ...props,
      },
    },
  );
  return { ...hook, onFailure };
};

describe('useStopBackgroundTask', () => {
  beforeEach(() => {
    stopHeteroBackgroundTask.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps showing stopping after the server accepted, until the task ends', async () => {
    stopHeteroBackgroundTask.mockResolvedValue({ status: 'accepted' });
    const { result, rerender, onFailure } = setup();

    await act(() => result.current.stop());
    expect(stopHeteroBackgroundTask).toHaveBeenCalledWith({ operationId: 'op-1', taskId: 'b1' });
    expect(result.current.stopping).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();

    rerender({ onFailure, operationId: 'op-1', route: 'server', running: false, taskId: 'b1' });
    expect(result.current.stopping).toBe(false);
    expect(result.current.canStop).toBe(false);
  });

  it.each([
    ['unsupported', 'upgradeLh'],
    ['unreachable', 'upgradeLh'],
    ['timeout', 'noAnswer'],
    ['failed', 'failed'],
  ])('reports a %s stop as %s', async (status, failure) => {
    stopHeteroBackgroundTask.mockResolvedValue({ error: 'x', status });
    const { result, onFailure } = setup();

    await act(() => result.current.stop());
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(result.current.stopping).toBe(false);
  });

  it('stops through the local session that registered for the run', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const unregister = registerLocalBackgroundTaskStopper('op-local', stop);
    const { result } = setup({ operationId: 'op-local', route: 'local' });

    await act(() => result.current.stop());
    expect(stop).toHaveBeenCalledWith('b1');
    expect(stopHeteroBackgroundTask).not.toHaveBeenCalled();
    unregister();
  });

  it('reports a local session that refused', async () => {
    const unregister = registerLocalBackgroundTaskStopper(
      'op-local',
      vi.fn().mockRejectedValue(new Error('no longer running')),
    );
    const { result, onFailure } = setup({ operationId: 'op-local', route: 'local' });

    await act(() => result.current.stop());
    expect(onFailure).toHaveBeenCalledWith('failed');
    unregister();
  });

  it('frees the button when the stopped snapshot never arrives', async () => {
    vi.useFakeTimers();
    stopHeteroBackgroundTask.mockResolvedValue({ status: 'accepted' });
    const { result } = setup();

    await act(() => result.current.stop());
    expect(result.current.stopping).toBe(true);
    act(() => {
      vi.advanceTimersByTime(STOP_PENDING_RESET_MS);
    });
    expect(result.current.stopping).toBe(false);
  });

  it('cannot stop without a route', () => {
    const { result } = setup({ route: undefined });
    expect(result.current.canStop).toBe(false);
  });
});
