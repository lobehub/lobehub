import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PRESENCE_REFRESH_INTERVAL_MS, useBoundDevice } from '../useBoundDevice';

const useDeviceList = vi.fn();
const mutate = vi.fn();

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: (...args: unknown[]) => useDeviceList(...args),
}));

const listState = (state: { data?: unknown; error?: unknown; isLoading?: boolean }) =>
  useDeviceList.mockReturnValue({ isLoading: false, mutate, ...state });

describe('useBoundDevice', () => {
  beforeEach(() => {
    useDeviceList.mockReset();
    mutate.mockReset();
    listState({ data: [{ deviceId: 'dev-1' }, { deviceId: 'dev-2' }] });
  });

  it('polls device presence while the Overview is on screen', () => {
    renderHook(() => useBoundDevice('dev-1', true));

    expect(useDeviceList).toHaveBeenCalledWith({ refreshInterval: PRESENCE_REFRESH_INTERVAL_MS });
  });

  it('stops polling device presence while the Overview is hidden', () => {
    renderHook(() => useBoundDevice('dev-1', false));

    expect(useDeviceList).toHaveBeenCalledWith({ refreshInterval: 0 });
  });

  it('resolves the bound device from the list', () => {
    const { result } = renderHook(() => useBoundDevice('dev-2', true));

    expect(result.current).toEqual({ device: { deviceId: 'dev-2' }, status: 'ready' });
  });

  it('reports a loaded list without the device as absent', () => {
    const { result } = renderHook(() => useBoundDevice('gone', true));

    expect(result.current).toEqual({ status: 'absent' });
  });

  it('reports the first load as loading', () => {
    listState({ isLoading: true });

    const { result } = renderHook(() => useBoundDevice('dev-1', true));

    expect(result.current).toEqual({ status: 'loading' });
  });

  it('reports a failed first load as an error with a retry, not as absent', () => {
    listState({ error: new Error('network') });

    const { result } = renderHook(() => useBoundDevice('dev-1', true));

    expect(result.current.status).toBe('error');
    if (result.current.status === 'error') result.current.retry();
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('keeps showing cached data when a later revalidation fails', () => {
    listState({ data: [{ deviceId: 'dev-1' }], error: new Error('network') });

    const { result } = renderHook(() => useBoundDevice('dev-1', true));

    expect(result.current).toEqual({ device: { deviceId: 'dev-1' }, status: 'ready' });
  });
});
