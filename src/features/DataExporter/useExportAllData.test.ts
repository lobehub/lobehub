import { toast } from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configService } from '@/services/config';

import { useExportAllData } from './useExportAllData';

vi.mock('@/services/config', () => ({
  configService: { exportAll: vi.fn() },
}));

vi.mock('@lobehub/ui', () => ({
  toast: { error: vi.fn() },
}));

describe('useExportAllData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the export as running until it settles', async () => {
    let finish!: () => void;
    vi.mocked(configService.exportAll).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    const { result } = renderHook(() => useExportAllData());

    let running!: Promise<void>;
    act(() => {
      running = result.current.exportAllData();
    });
    expect(result.current.exporting).toBe(true);

    await act(async () => {
      finish();
      await running;
    });
    expect(result.current.exporting).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('tells the user when the export fails', async () => {
    vi.mocked(configService.exportAll).mockRejectedValue(new Error('Invalid string length'));

    const { result } = renderHook(() => useExportAllData());

    await act(() => result.current.exportAllData());

    expect(toast.error).toHaveBeenCalledWith('storage.actions.export.error');
    expect(result.current.exporting).toBe(false);
  });
});
