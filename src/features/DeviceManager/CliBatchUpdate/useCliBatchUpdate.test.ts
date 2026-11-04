import {
  DEVICE_CLI_BATCH_MAX_TARGETS,
  type DeviceCliBatchEntry,
  type DeviceCliUpdateStateResult,
} from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';

import { refreshDeviceList } from '../const';
import { useCliBatchUpdate } from './useCliBatchUpdate';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'workspace',
}));
vi.mock('@/services/device', () => ({
  deviceService: { checkCliUpdates: vi.fn(), getCliUpdateState: vi.fn(), updateClis: vi.fn() },
}));
vi.mock('../const', () => ({ refreshDeviceList: vi.fn() }));

const state = (instanceId: string, currentVersion: string) => ({
  activeTasks: 0,
  currentVersion,
  instanceId,
  latestVersion: currentVersion === '0.0.75' ? undefined : '0.0.75',
  supported: true,
});

const plan: DeviceCliBatchEntry[] = [
  { deviceId: 'a', outcome: 'ready', state: state('a-old', '0.0.70') },
  { deviceId: 'b', outcome: 'ready', state: state('b-old', '0.0.70') },
  { deviceId: 'c', outcome: 'busy', state: { ...state('c', '0.0.70'), activeTasks: 1 } },
  { deviceId: 'd', outcome: 'offline' },
];

const requested = (deviceId: string): DeviceCliBatchEntry => ({
  deviceId,
  operation: {
    fromInstanceId: `${deviceId}-old`,
    id: `${deviceId}-request`,
    kind: 'update',
    stage: 'updating',
    targetVersion: '0.0.75',
  },
  outcome: 'requested',
});

const render = () => {
  const cache = new Map();
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(SWRConfig, { value: { provider: () => cache } }, children);
  return renderHook(() => useCliBatchUpdate('public'), { wrapper });
};

const flush = (ms = 1) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(deviceService.checkCliUpdates).mockResolvedValue(plan);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useCliBatchUpdate', () => {
  it('plans the tab and sends restarts only to ready devices', async () => {
    vi.mocked(deviceService.updateClis).mockResolvedValue([requested('a'), requested('b')]);
    vi.mocked(deviceService.getCliUpdateState).mockResolvedValue({
      message: 'restarting',
      status: 'unavailable',
    });
    const { result, unmount } = render();
    expect(result.current.phase).toBe('checking');
    await flush();

    expect(deviceService.checkCliUpdates).toHaveBeenCalledWith({ visibility: 'public' });
    expect(result.current.phase).toBe('review');
    expect(result.current.summary).toMatchObject({ ready: 2, skipped: 2 });

    await act(async () => {
      await result.current.update();
    });
    const { targets } = vi.mocked(deviceService.updateClis).mock.calls[0][0];
    expect(targets.map((target) => target.deviceId)).toEqual(['a', 'b']);
    expect(new Set(targets.map((target) => target.requestId)).size).toBe(2);
    expect(result.current.phase).toBe('following');
    unmount();
  });

  it('follows each device until it reconnects on the target, then stops polling', async () => {
    vi.mocked(deviceService.updateClis).mockResolvedValue([requested('a'), requested('b')]);
    const reported: Record<string, DeviceCliUpdateStateResult> = {
      a: { state: state('a-new', '0.0.75'), status: 'ok' },
      b: { message: 'restarting', status: 'unavailable' },
    };
    vi.mocked(deviceService.getCliUpdateState).mockImplementation(
      async ({ deviceId }) => reported[deviceId],
    );
    const { result, unmount } = render();
    await flush();
    await act(async () => {
      await result.current.update();
    });
    await flush();

    expect(result.current.rows.map((row) => [row.entry.deviceId, row.view])).toEqual([
      ['a', 'success'],
      ['b', 'pending'],
      ['c', 'busy'],
      ['d', 'offline'],
    ]);

    reported.b = { state: state('b-new', '0.0.75'), status: 'ok' };
    await flush(3000);
    expect(result.current.phase).toBe('done');
    expect(result.current.summary).toMatchObject({ pending: 0, skipped: 2, updated: 2 });
    expect(refreshDeviceList).toHaveBeenCalled();

    // `a` settled first and was asked once; neither is asked after both settle.
    const calls = vi.mocked(deviceService.getCliUpdateState).mock.calls;
    expect(calls.filter(([input]) => input.deviceId === 'a')).toHaveLength(1);
    const settledCalls = calls.length;
    await flush(9000);
    expect(deviceService.getCliUpdateState).toHaveBeenCalledTimes(settledCalls);
    unmount();
  });

  it("keeps the device's live state so a failed row can show why", async () => {
    vi.mocked(deviceService.updateClis).mockResolvedValue([
      { ...requested('a'), message: 'relay timeout' },
    ]);
    const failed: DeviceCliUpdateStateResult = {
      state: {
        ...state('a-old', '0.0.70'),
        operation: { ...requested('a').operation!, error: 'npm exited with 1', stage: 'failed' },
      },
      status: 'ok',
    };
    vi.mocked(deviceService.getCliUpdateState).mockResolvedValue(failed);
    const { result, unmount } = render();
    await flush();
    await act(async () => {
      await result.current.update();
    });
    await flush();

    expect(result.current.rows[0]).toMatchObject({ follow: failed, view: 'failed' });
    unmount();
  });

  it('marks a device that never comes back as not confirmed after five minutes', async () => {
    vi.mocked(deviceService.updateClis).mockResolvedValue([requested('a')]);
    vi.mocked(deviceService.getCliUpdateState).mockResolvedValue({
      message: 'restarting',
      status: 'unavailable',
    });
    const { result, unmount } = render();
    await flush();
    await act(async () => {
      await result.current.update();
    });
    await flush(5 * 60_000);

    expect(result.current.rows[0].view).toBe('timedOut');
    expect(result.current.phase).toBe('done');
    unmount();
  });

  it('marks the devices of a failed request and offers a fresh check', async () => {
    vi.mocked(deviceService.updateClis).mockRejectedValue(new Error('network'));
    const { result, unmount } = render();
    await flush();
    await act(async () => {
      await result.current.update();
    });

    expect(result.current.sendError).toBe('network');
    expect(result.current.phase).toBe('done');
    expect(result.current.rows.map((row) => [row.entry.deviceId, row.view])).toEqual([
      ['a', 'failed'],
      ['b', 'failed'],
      ['c', 'busy'],
      ['d', 'offline'],
    ]);

    act(() => result.current.recheck());
    expect(result.current.phase).toBe('checking');
    await flush();
    expect(deviceService.checkCliUpdates).toHaveBeenCalledTimes(2);
    expect(result.current.sendError).toBeUndefined();
    unmount();
  });

  it('sends a pool larger than one request allows in chunks', async () => {
    const pool = Array.from({ length: DEVICE_CLI_BATCH_MAX_TARGETS + 3 }, (_, i) => `dev-${i}`);
    vi.mocked(deviceService.checkCliUpdates).mockResolvedValue(
      pool.map((deviceId) => ({
        deviceId,
        outcome: 'ready',
        state: state(`${deviceId}-old`, '0.0.70'),
      })),
    );
    vi.mocked(deviceService.updateClis)
      .mockImplementationOnce(async ({ targets }) => targets.map((t) => requested(t.deviceId)))
      .mockRejectedValueOnce(new Error('function timeout'));
    vi.mocked(deviceService.getCliUpdateState).mockResolvedValue({
      message: 'restarting',
      status: 'unavailable',
    });
    const { result, unmount } = render();
    await flush();
    await act(async () => {
      await result.current.update();
    });

    const sizes = vi
      .mocked(deviceService.updateClis)
      .mock.calls.map(([input]) => input.targets.length);
    expect(sizes).toEqual([DEVICE_CLI_BATCH_MAX_TARGETS, 3]);
    // The first chunk is followed; only the failed chunk's devices are marked failed.
    expect(result.current.summary).toMatchObject({
      failed: 3,
      pending: DEVICE_CLI_BATCH_MAX_TARGETS,
    });
    expect(result.current.sendError).toBe('function timeout');
    expect(result.current.phase).toBe('following');
    unmount();
  });
});
