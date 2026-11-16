import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useExportAllData } from './useExportAllData';

const mocks = vi.hoisted(() => ({
  exportAll: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('@/services/config', () => ({
  configService: { exportAll: mocks.exportAll },
}));

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

describe('useExportAllData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('marks the export as running until it completes, then reports success', async () => {
    const pending = deferred();
    mocks.exportAll.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useExportAllData());
    let run!: Promise<void>;

    act(() => {
      run = result.current.exportAll();
    });

    expect(result.current.exporting).toBe(true);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve();
      await run;
    });

    expect(result.current.exporting).toBe(false);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('storage.actions.export.success');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('ignores repeated clicks while an export is running', async () => {
    const pending = deferred();
    mocks.exportAll.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useExportAllData());
    let first!: Promise<void>;

    act(() => {
      first = result.current.exportAll();
      void result.current.exportAll();
    });

    await act(async () => {
      void result.current.exportAll();
      pending.resolve();
      await first;
    });

    expect(mocks.exportAll).toHaveBeenCalledTimes(1);
  });

  it('reports a failed export instead of failing silently', async () => {
    mocks.exportAll.mockRejectedValue(new Error('timeout'));

    const { result } = renderHook(() => useExportAllData());

    await act(async () => {
      await result.current.exportAll();
    });

    expect(result.current.exporting).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith('storage.actions.export.error');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
