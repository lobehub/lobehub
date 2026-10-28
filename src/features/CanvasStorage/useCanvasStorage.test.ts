import type { CanvasStorageItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({ confirmModal: vi.fn(), error: vi.fn(), success: vi.fn() }));
const canvas = vi.hoisted(() => ({ delete: vi.fn(), listStorage: vi.fn() }));
const work = vi.hoisted(() => ({ refreshAllConversations: vi.fn(), removeWork: vi.fn() }));
const mutate = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: ui.confirmModal,
  toast: { error: ui.error, success: ui.success },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@/libs/swr', () => ({
  mutate,
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/services/canvas', () => ({ canvasService: canvas }));
vi.mock('@/services/work', () => ({
  workService: { refreshAllConversations: work.refreshAllConversations },
}));
vi.mock('@/store/work', () => ({ workActions: { removeWork: work.removeWork } }));

const { summarizeCanvasStorage, useDeleteCanvas } = await import('./useCanvasStorage');

const item = (overrides: Partial<CanvasStorageItem> = {}): CanvasStorageItem => ({
  canvasId: 'cvs_1',
  fileCount: 17,
  title: 'Climate Alarm',
  totalSize: 17.4 * 1024 * 1024,
  updatedAt: new Date('2026-10-28T00:00:00Z'),
  workId: 'work-1',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('summarizeCanvasStorage', () => {
  it('totals the storage every canvas holds for the drive entry', () => {
    expect(
      summarizeCanvasStorage([
        item({ totalSize: 300 }),
        item({ canvasId: 'cvs_2', totalSize: 200 }),
      ]),
    ).toEqual({ count: 2, totalSize: 500 });
  });

  it('hides the entry while canvases hold no storage', () => {
    expect(summarizeCanvasStorage(undefined)).toBeNull();
    expect(summarizeCanvasStorage([])).toBeNull();
    expect(summarizeCanvasStorage([item({ totalSize: 0 })])).toBeNull();
  });
});

describe('useDeleteCanvas', () => {
  it('deletes the whole canvas after confirmation and drops it from every list', async () => {
    canvas.delete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteCanvas());

    act(() => result.current(item()));
    expect(canvas.delete).not.toHaveBeenCalled();
    await act(() => ui.confirmModal.mock.calls[0][0].onOk());

    expect(canvas.delete).toHaveBeenCalledWith('cvs_1');
    expect(work.removeWork).toHaveBeenCalledWith('work-1');
    expect(mutate).toHaveBeenCalledWith(['canvas:storage']);
    await waitFor(() =>
      expect(ui.success).toHaveBeenCalledWith('canvasStorage.delete.success {"size":"17.4 MB"}'),
    );
  });

  it('frees files left without a Work by canvas id alone', async () => {
    canvas.delete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteCanvas());

    act(() => result.current(item({ title: null, workId: null })));
    await act(() => ui.confirmModal.mock.calls[0][0].onOk());

    expect(canvas.delete).toHaveBeenCalledWith('cvs_1');
    expect(work.removeWork).not.toHaveBeenCalled();
  });

  it('keeps the canvas listed and reports a failed delete', async () => {
    canvas.delete.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useDeleteCanvas());

    act(() => result.current(item()));
    await act(() => ui.confirmModal.mock.calls[0][0].onOk());

    expect(work.removeWork).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith('operationFailed {"ns":"common"}');
  });
});
