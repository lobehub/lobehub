import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxStorageService } from '@/services/sandboxStorage';

import { useDriveUsage, useRemeasureDrive } from './useDriveData';

const mutate = vi.hoisted(() => vi.fn());
const globalMutate = vi.hoisted(() => vi.fn());
const workspace = vi.hoisted(() => ({ id: 'ws_1' as string | null }));

vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: globalMutate }) }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => workspace.id,
}));

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

// A delete only marks the stored figure stale (T-14518): the usage read keeps
// returning the figure measured before it, so the drive is measured again.
describe('useRemeasureDrive', () => {
  const measuring = {
    usageMeasurement: { scannedBytes: 300, startedAt: null, status: 'measuring' },
  } as any;

  beforeEach(() => {
    vi.useFakeTimers();
    globalMutate.mockReset().mockResolvedValue(undefined);
    workspace.id = 'ws_1';
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should measure the drive and reload the usage', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockResolvedValue({} as any);
    const { result } = renderHook(() => useRemeasureDrive());

    await result.current('public');

    expect(sandboxStorageService.refreshStorageUsage).toHaveBeenCalledTimes(1);
    expect(sandboxStorageService.refreshStorageUsage).toHaveBeenCalledWith({ drive: 'public' });
    expect(globalMutate).toHaveBeenCalledTimes(1);
    const matches = globalMutate.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matches(['sandbox-drive-usage'])).toBe(true);
    expect(matches(['sandbox-drive-files', 'public', ''])).toBe(false);
  });

  it('should keep walking a large drive until the measurement finishes', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage)
      .mockResolvedValueOnce(measuring)
      .mockResolvedValueOnce(measuring)
      .mockResolvedValueOnce({} as any);
    const { result } = renderHook(() => useRemeasureDrive());

    const running = result.current('personal');
    await vi.runAllTimersAsync();
    await running;

    expect(sandboxStorageService.refreshStorageUsage).toHaveBeenCalledTimes(3);
    expect(globalMutate).toHaveBeenCalledTimes(3);
  });

  it('should stop after a bounded number of calls', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockResolvedValue(measuring);
    const { result } = renderHook(() => useRemeasureDrive());

    const running = result.current('personal');
    await vi.runAllTimersAsync();
    await running;

    expect(sandboxStorageService.refreshStorageUsage).toHaveBeenCalledTimes(12);
  });

  it('should not carry a walk into another workspace', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockImplementation(async () => {
      workspace.id = 'ws_2';
      return measuring;
    });
    const { result } = renderHook(() => useRemeasureDrive());

    const running = result.current('public');
    await vi.runAllTimersAsync();
    await running;

    expect(sandboxStorageService.refreshStorageUsage).toHaveBeenCalledTimes(1);
    expect(globalMutate).not.toHaveBeenCalled();
  });

  it('should not measure when the workspace changed before the delete finished', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockResolvedValue({} as any);
    const { result } = renderHook(() => useRemeasureDrive());

    // The delete began in ws_1; the user is in ws_2 by the time it ends.
    workspace.id = 'ws_2';
    await result.current('public', 'ws_1');

    expect(sandboxStorageService.refreshStorageUsage).not.toHaveBeenCalled();
    expect(globalMutate).not.toHaveBeenCalled();
  });

  it('should swallow a failed measurement', async () => {
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useRemeasureDrive());

    await expect(result.current('public')).resolves.toBeUndefined();
  });
});
