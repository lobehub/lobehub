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

const { summarizeCanvasStorage, useCleanOrphanCanvasFiles, useDeleteCanvas } =
  await import('./useCanvasStorage');

const item = (overrides: Partial<CanvasStorageItem> = {}): CanvasStorageItem => ({
  canvasId: 'cvs_1',
  fileCount: 17,
  title: 'Climate Alarm',
  totalSize: 17.4 * 1024 * 1024,
  updatedAt: new Date('2026-10-28T00:00:00Z'),
  workId: 'work-1',
  ...overrides,
});

const canvasOf = (overrides: Record<string, unknown> = {}) => ({
  canvasId: 'cvs_1',
  title: 'Climate Alarm',
  totalSize: 17.4 * 1024 * 1024,
  workId: 'work-1',
  ...overrides,
});

const confirmLatest = () => act(() => ui.confirmModal.mock.calls.at(-1)![0].onOk());

beforeEach(() => {
  vi.clearAllMocks();
});

describe('summarizeCanvasStorage', () => {
  it('totals canvases by id and sets aside files whose Work is gone', () => {
    const summary = summarizeCanvasStorage([
      item({ totalSize: 300 }),
      item({ canvasId: 'cvs_2', totalSize: 200, workId: 'work-2' }),
      item({ canvasId: 'cvs_orphan', title: null, totalSize: 40, workId: null }),
    ]);

    expect(summary.canvasCount).toBe(2);
    expect(summary.canvasSize).toBe(500);
    expect(summary.byCanvas.get('cvs_2')?.totalSize).toBe(200);
    expect(summary.orphans.map((orphan) => orphan.canvasId)).toEqual(['cvs_orphan']);
    expect(summary.orphanSize).toBe(40);
  });

  it('is empty before the usage loads', () => {
    expect(summarizeCanvasStorage(undefined)).toMatchObject({
      canvasCount: 0,
      canvasSize: 0,
      orphanSize: 0,
      orphans: [],
    });
  });
});

describe('useDeleteCanvas', () => {
  it('deletes the whole canvas after confirmation and drops it from every list', async () => {
    canvas.delete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteCanvas());

    act(() => result.current(canvasOf()));
    expect(canvas.delete).not.toHaveBeenCalled();
    expect(ui.confirmModal.mock.calls[0][0].content).toBe(
      'canvasStorage.delete.content {"size":"17.4 MB","title":"Climate Alarm"}',
    );
    await confirmLatest();

    expect(canvas.delete).toHaveBeenCalledWith('cvs_1');
    expect(work.removeWork).toHaveBeenCalledWith('work-1');
    expect(mutate).toHaveBeenCalledWith(['canvas:storage']);
    await waitFor(() =>
      expect(ui.success).toHaveBeenCalledWith('canvasStorage.delete.success {"size":"17.4 MB"}'),
    );
  });

  it('warns that a published canvas goes offline, and confirms without a known size', () => {
    const { result } = renderHook(() => useDeleteCanvas());

    act(() =>
      result.current(
        canvasOf({ publishedUrl: 'https://climate.lobehub.sites', totalSize: undefined }),
      ),
    );

    expect(ui.confirmModal.mock.calls[0][0].content).toBe(
      'canvasStorage.delete.contentNoSize {"title":"Climate Alarm"} canvasStorage.delete.published',
    );
  });

  it('deletes by canvas id alone and lets the caller refresh its own list', async () => {
    canvas.delete.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteCanvas({ onDeleted }));

    act(() => result.current(canvasOf({ totalSize: undefined, workId: undefined })));
    await confirmLatest();

    expect(canvas.delete).toHaveBeenCalledWith('cvs_1');
    expect(work.removeWork).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(ui.success).toHaveBeenCalledWith('canvasStorage.delete.successNoSize');
  });

  it('keeps the canvas listed and reports a failed delete', async () => {
    canvas.delete.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useDeleteCanvas());

    act(() => result.current(canvasOf()));
    await confirmLatest();

    expect(work.removeWork).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith('operationFailed {"ns":"common"}');
  });
});

describe('useCleanOrphanCanvasFiles', () => {
  it('frees every leftover canvas by id after one confirmation', async () => {
    canvas.delete.mockResolvedValue({ deleted: true });
    const { result } = renderHook(() => useCleanOrphanCanvasFiles());

    act(() =>
      result.current([
        item({ canvasId: 'cvs_a', totalSize: 1024, workId: null }),
        item({ canvasId: 'cvs_b', totalSize: 1024, workId: null }),
      ]),
    );
    await confirmLatest();

    expect(canvas.delete.mock.calls).toEqual([
      ['cvs_a', { orphanOnly: true }],
      ['cvs_b', { orphanOnly: true }],
    ]);
    expect(work.removeWork).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith(['canvas:storage']);
    expect(ui.success).toHaveBeenCalledWith('canvasStorage.orphan.success {"size":"2.0 KB"}');
  });

  it('counts only what was freed when a leftover turned out to have a Work', async () => {
    canvas.delete
      .mockResolvedValueOnce({ deleted: true })
      .mockResolvedValueOnce({ deleted: false });
    const { result } = renderHook(() => useCleanOrphanCanvasFiles());

    act(() =>
      result.current([
        item({ canvasId: 'cvs_a', totalSize: 1024, workId: null }),
        item({ canvasId: 'cvs_live', totalSize: 4096, workId: null }),
      ]),
    );
    await confirmLatest();

    expect(ui.success).toHaveBeenCalledWith('canvasStorage.orphan.success {"size":"1.0 KB"}');
  });

  it('counts a delete from a server that reports no result as freed', async () => {
    canvas.delete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCleanOrphanCanvasFiles());

    act(() => result.current([item({ canvasId: 'cvs_a', totalSize: 1024, workId: null })]));
    await confirmLatest();

    expect(ui.success).toHaveBeenCalledWith('canvasStorage.orphan.success {"size":"1.0 KB"}');
  });

  it('refreshes what is left when a cleanup fails part way', async () => {
    canvas.delete.mockResolvedValueOnce({ deleted: true }).mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCleanOrphanCanvasFiles());

    act(() =>
      result.current([
        item({ canvasId: 'cvs_a', workId: null }),
        item({ canvasId: 'cvs_b', workId: null }),
      ]),
    );
    await confirmLatest();

    expect(mutate).toHaveBeenCalledWith(['canvas:storage']);
    expect(ui.error).toHaveBeenCalledWith('operationFailed {"ns":"common"}');
  });
});
