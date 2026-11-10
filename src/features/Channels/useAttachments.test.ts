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
    const { result } = renderHook(() => useAttachments());

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
