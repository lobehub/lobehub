import type { DeviceCliUpdateStateResult } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';

import { useDeviceCliUpdate } from './useDeviceCliUpdate';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/services/device', () => ({ deviceService: { getCliUpdateState: vi.fn() } }));
vi.mock('../const', () => ({ refreshDeviceList: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('CLI maintenance availability', () => {
  it('automatically restores availability after tasks finish, then stops polling', async () => {
    vi.useFakeTimers();
    let activeTasks = 1;
    vi.mocked(deviceService.getCliUpdateState).mockImplementation(
      async () =>
        ({
          status: 'ok',
          state: {
            activeTasks,
            currentVersion: '2.1.0',
            instanceId: 'daemon',
            latestVersion: '2.1.1',
            supported: true,
          },
        }) satisfies DeviceCliUpdateStateResult,
    );
    const cache = new Map();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(SWRConfig, { value: { provider: () => cache } }, children);
    const { result, unmount } = renderHook(() => useDeviceCliUpdate('device', true, true), {
      wrapper,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state?.activeTasks).toBe(1);
    expect(result.current.allowed).toBe(false);

    activeTasks = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.state?.activeTasks).toBe(0);
    expect(result.current.allowed).toBe(true);
    expect(deviceService.getCliUpdateState).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(deviceService.getCliUpdateState).toHaveBeenCalledTimes(2);
    unmount();
  });
});
