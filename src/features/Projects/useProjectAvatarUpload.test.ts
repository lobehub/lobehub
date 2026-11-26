import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useProjectAvatarUpload } from './useProjectAvatarUpload';

const uploadWithProgress = vi.fn();

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: unknown) => unknown) => selector({ uploadWithProgress }),
}));

afterEach(() => {
  uploadWithProgress.mockReset();
});

const pickedFile = () => new File(['x'], 'avatar.webp', { type: 'image/webp' });

describe('useProjectAvatarUpload', () => {
  it('reports an upload in flight so the form can wait for its avatar', async () => {
    let finish!: (result: { url: string }) => void;
    uploadWithProgress.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onChange = vi.fn();
    const onUploadingChange = vi.fn();
    const { result } = renderHook(() => useProjectAvatarUpload({ onChange, onUploadingChange }));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.upload(pickedFile(), { crop: false });
    });

    expect(onUploadingChange).toHaveBeenLastCalledWith(true);
    expect(result.current.uploading).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      finish({ url: 'https://files.example.com/avatar.webp' });
      await pending;
    });

    expect(onChange).toHaveBeenCalledWith('https://files.example.com/avatar.webp');
    expect(onUploadingChange).toHaveBeenLastCalledWith(false);
    expect(result.current.uploading).toBe(false);
  });

  it('releases the form when the upload fails', async () => {
    uploadWithProgress.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onChange = vi.fn();
    const onUploadingChange = vi.fn();
    const { result } = renderHook(() => useProjectAvatarUpload({ onChange, onUploadingChange }));

    await act(async () => {
      await result.current.upload(pickedFile(), { crop: false });
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onUploadingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps the failure as an inline error instead of a toast, and clears it on the next try', async () => {
    uploadWithProgress.mockRejectedValueOnce(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useProjectAvatarUpload({ onChange: vi.fn() }));

    await act(async () => {
      await result.current.upload(pickedFile(), { crop: false });
    });
    expect(result.current.error).toBe('create.avatarUploadFailed');

    uploadWithProgress.mockResolvedValueOnce({ url: 'https://files.example.com/a.webp' });
    await act(async () => {
      await result.current.upload(pickedFile(), { crop: false });
    });
    expect(result.current.error).toBe('');
  });
});
