import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxStorageService } from '@/services/sandboxStorage';

import { useDriveUsage } from './useDriveData';

const mutate = vi.hoisted(() => vi.fn());

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: { drives: [{ drive: 'public' }, { drive: 'personal' }] },
    error: undefined,
    isLoading: false,
    mutate,
  }),
}));

vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { getDriveUsage: vi.fn(), refreshStorageUsage: vi.fn() },
}));

describe('useDriveUsage refresh', () => {
  beforeEach(() => {
    mutate.mockReset().mockResolvedValue(undefined);
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockReset();
  });

  it('should measure every drive, reload, and still report a failed one', async () => {
    // One drive measured, the other not: the caller has to hear about it
    // rather than show a mixture as if both were fresh.
    vi.mocked(sandboxStorageService.refreshStorageUsage)
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new Error('sandbox unavailable'));
    const { result } = renderHook(() => useDriveUsage());
    await waitFor(() => expect(result.current.data).toBeDefined());

    await act(async () => {
      await expect(result.current.refresh()).rejects.toThrow('sandbox unavailable');
    });

    expect(sandboxStorageService.refreshStorageUsage).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('should resolve when every drive was measured', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockResolvedValue({} as any);
    const { result } = renderHook(() => useDriveUsage());

    await act(async () => {
      await expect(result.current.refresh()).resolves.toEqual({});
    });
  });

  // A drive too large to walk in one call answers "still measuring".
  it('should report a drive still being measured with what has been counted', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage)
      .mockResolvedValueOnce({
        usageMeasurement: { scannedBytes: 300, startedAt: null, status: 'measuring' },
      } as any)
      .mockResolvedValueOnce({} as any);
    const { result } = renderHook(() => useDriveUsage());
    await waitFor(() => expect(result.current.data).toBeDefined());

    await act(async () => {
      await expect(result.current.refresh()).resolves.toEqual({
        measuring: { drives: ['public'], scannedBytes: 300 },
      });
    });
  });

  it('should still say measuring when the walk has not reported a count yet', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockResolvedValue({
      usageMeasurement: { scannedBytes: null, startedAt: null, status: 'measuring' },
    } as any);
    const { result } = renderHook(() => useDriveUsage());
    await waitFor(() => expect(result.current.data).toBeDefined());

    await act(async () => {
      await expect(result.current.refresh()).resolves.toEqual({
        measuring: { drives: ['public', 'personal'], scannedBytes: null },
      });
    });
  });

  it('should measure only the drives it is given', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockResolvedValue({} as any);
    const { result } = renderHook(() => useDriveUsage());
    await waitFor(() => expect(result.current.data).toBeDefined());

    await act(async () => {
      await result.current.refresh(['personal']);
    });

    expect(sandboxStorageService.refreshStorageUsage).toHaveBeenCalledTimes(1);
    expect(sandboxStorageService.refreshStorageUsage).toHaveBeenCalledWith({ drive: 'personal' });
  });
});
