import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';

import { useDeviceAgentCliUpdate } from './useDeviceAgentCliUpdate';

const running = { agentType: 'claude-code', startedAt: 1, status: 'running' as const };
const succeeded = {
  ...running,
  finishedAt: 2,
  fromVersion: '2.1.301',
  status: 'succeeded' as const,
  version: '2.1.316',
};

// A fresh SWR cache per test, so one test's job never answers another's.
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const renderUpdate = (enabled = true) => {
  const onFinish = vi.fn();
  const view = renderHook(
    () =>
      useDeviceAgentCliUpdate({
        agentType: 'claude-code',
        deviceId: 'device-1',
        enabled,
        onFinish,
      }),
    { wrapper },
  );
  return { ...view, onFinish };
};

describe('useDeviceAgentCliUpdate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('never asks a device that cannot update the CLI', () => {
    const getAgentCliUpdate = vi.spyOn(deviceService, 'getAgentCliUpdate');

    renderUpdate(false);

    expect(getAgentCliUpdate).not.toHaveBeenCalled();
  });

  it('shows an update already running on the device', async () => {
    vi.spyOn(deviceService, 'getAgentCliUpdate').mockResolvedValue({ job: running, status: 'ok' });

    const { result } = renderUpdate();

    await waitFor(() => expect(result.current.job).toEqual(running));
    expect(deviceService.getAgentCliUpdate).toHaveBeenCalledWith({
      agentType: 'claude-code',
      deviceId: 'device-1',
    });
  });

  it('polls a started update until it ends, then re-scans once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getAgentCliUpdate = vi
      .spyOn(deviceService, 'getAgentCliUpdate')
      .mockResolvedValueOnce({ job: null, status: 'ok' })
      .mockResolvedValue({ job: succeeded, status: 'ok' });
    vi.spyOn(deviceService, 'startAgentCliUpdate').mockResolvedValue({
      job: running,
      status: 'ok',
    });

    const { onFinish, result } = renderUpdate();
    await waitFor(() => expect(getAgentCliUpdate).toHaveBeenCalledTimes(1));

    await act(() => result.current.start());
    expect(result.current.job).toEqual(running);
    expect(onFinish).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(2000));

    await waitFor(() => expect(result.current.job).toEqual(succeeded));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(result.current.failed).toBe(false);
  });

  it('reports a device that refused the update', async () => {
    vi.spyOn(deviceService, 'getAgentCliUpdate').mockResolvedValue({ job: null, status: 'ok' });
    vi.spyOn(deviceService, 'startAgentCliUpdate').mockResolvedValue({
      message: 'device offline',
      status: 'unavailable',
    });

    const { result } = renderUpdate();
    await act(() => result.current.start());

    expect(result.current.failed).toBe(true);
    expect(result.current.error).toBe('device offline');
  });

  it('reports the output of an update that failed on the device', async () => {
    vi.spyOn(deviceService, 'getAgentCliUpdate').mockResolvedValue({
      job: { ...running, error: 'EACCES: denied', status: 'failed' },
      status: 'ok',
    });

    const { result } = renderUpdate();

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.error).toBe('EACCES: denied');
  });
});
