import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLogoUpload } from './useLogoUpload';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  uploadWithProgress: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: mocks.toastError } }));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: unknown) => unknown) =>
    selector({ uploadWithProgress: mocks.uploadWithProgress }),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const file = (size = 1024) => new File([new Uint8Array(size)], 'logo.png', { type: 'image/png' });

describe('useLogoUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the uploaded https URL, never an inline data URI', async () => {
    mocks.uploadWithProgress.mockResolvedValue({ url: 'https://files.lobehub.com/logo.png' });
    const { result } = renderHook(() => useLogoUpload());

    let url: string | undefined;
    await act(async () => {
      url = await result.current.upload(file());
    });

    expect(url).toBe('https://files.lobehub.com/logo.png');
    expect(url?.startsWith('data:')).toBe(false);
  });

  it('turns a storage path into an absolute URL the provider accepts', async () => {
    mocks.uploadWithProgress.mockResolvedValue({ url: '/f/logo.png' });
    const { result } = renderHook(() => useLogoUpload());

    let url: string | undefined;
    await act(async () => {
      url = await result.current.upload(file());
    });

    expect(url).toBe(`${window.location.origin}/f/logo.png`);
  });

  it('refuses a file over 2 MB without uploading it', async () => {
    const { result } = renderHook(() => useLogoUpload());

    let url: string | undefined;
    await act(async () => {
      url = await result.current.upload(file(2 * 1024 * 1024 + 1));
    });

    expect(url).toBeUndefined();
    expect(mocks.uploadWithProgress).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('oauthApp.form.logo.tooLarge');
  });

  it('reports a failed upload and returns nothing', async () => {
    mocks.uploadWithProgress.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useLogoUpload());

    let url: string | undefined;
    await act(async () => {
      url = await result.current.upload(file());
    });

    expect(url).toBeUndefined();
    expect(mocks.toastError).toHaveBeenCalledWith('oauthApp.form.logo.uploadFailed');
    expect(result.current.uploading).toBe(false);
  });
});
