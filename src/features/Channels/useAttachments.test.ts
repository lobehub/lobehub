/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAttachments } from './useAttachments';

const upload = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({ toast: { error: vi.fn() } }));
vi.mock('@lobechat/utils/compressImage', () => ({
  COMPRESSIBLE_IMAGE_TYPES: new Set(),
  compressImageFile: vi.fn(),
}));
vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: { uploadWithProgress: typeof upload }) => unknown) =>
    selector({ uploadWithProgress: upload }),
}));

describe('useAttachments local image previews', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows an image from a local URL at once and releases it when removed', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shot');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    upload.mockResolvedValue({ id: 'file-1', url: 'https://cdn/shot.png' });
    const { result } = renderHook(() => useAttachments('channel:ch-1:main'));

    await act(() =>
      result.current.upload([
        new File(['x'], 'shot.png', { type: 'image/png' }),
        new File(['x'], 'notes.txt', { type: 'text/plain' }),
      ]),
    );

    expect(create).toHaveBeenCalledTimes(1);
    const [image, text] = result.current.items;
    expect(image).toMatchObject({ previewUrl: 'blob:shot', status: 'success' });
    expect(text.previewUrl).toBeUndefined();

    act(() => result.current.remove(image.id));
    expect(revoke).toHaveBeenCalledWith('blob:shot');
  });
});

describe('useAttachments across composers of one conversation', () => {
  afterEach(() => vi.useRealTimers());

  it('hands files and running uploads to the composer that takes over the thread', async () => {
    vi.useFakeTimers();
    let finish: (value: { id: string; url: string }) => void = () => {};
    upload.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const panel = renderHook(() => useAttachments('channel:ch-1:thread-1'));
    act(() => {
      void panel.result.current.upload([new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    });
    await act(async () => {});
    const signal = upload.mock.calls.at(-1)![0].abortController.signal as AbortSignal;

    // Opening the thread as the page: the page composer mounts as the panel one goes away.
    const page = renderHook(() => useAttachments('channel:ch-1:thread-1'));
    panel.unmount();
    await act(() => vi.runAllTimersAsync());

    expect(signal.aborted).toBe(false);
    expect(page.result.current.items).toHaveLength(1);
    await act(async () => finish({ id: 'file-1', url: 'https://cdn/notes.txt' }));
    expect(page.result.current.items[0]).toMatchObject({ fileId: 'file-1', status: 'success' });

    // Nobody writes to the thread any more: its uploads stop and the draft is released.
    page.unmount();
    await act(() => vi.runAllTimersAsync());
    const again = renderHook(() => useAttachments('channel:ch-1:thread-1'));
    expect(again.result.current.items).toHaveLength(0);
  });

  it('aborts a running upload once its last composer is gone', async () => {
    vi.useFakeTimers();
    upload.mockReturnValue(new Promise(() => {}));
    const composer = renderHook(() => useAttachments('channel:ch-1:thread-2'));
    act(() => {
      void composer.result.current.upload([new File(['x'], 'a.txt', { type: 'text/plain' })]);
    });
    await act(async () => {});
    const signal = upload.mock.calls.at(-1)![0].abortController.signal as AbortSignal;

    composer.unmount();
    await act(() => vi.runAllTimersAsync());
    expect(signal.aborted).toBe(true);
  });
});
