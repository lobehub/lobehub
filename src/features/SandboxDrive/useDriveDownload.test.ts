import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDriveDownload } from './useDriveDownload';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  prepareDownload: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({ toast: { error: mocks.error, loading: mocks.loading } }));
vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { prepareDownload: mocks.prepareDownload },
}));

describe('useDriveDownload', () => {
  let clicked: { download: string; href: string }[];

  beforeEach(() => {
    clicked = [];
    mocks.close.mockReset();
    mocks.error.mockReset();
    mocks.prepareDownload.mockReset();
    mocks.loading.mockReset().mockReturnValue({ close: mocks.close });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const download = (drive: 'personal' | 'public', entry: { name: string; path: string }) => {
    const { result } = renderHook(() => useDriveDownload(drive));
    return act(() => result.current(entry));
  };

  it('saves the link the server prepared, under its name, from the drive it is on', async () => {
    mocks.prepareDownload.mockResolvedValue({
      fileName: 'project.zip',
      kind: 'directory',
      url: 'https://files.example.com/project.zip?sig=1',
    });

    await download('public', { name: 'project', path: 'work/project' });

    expect(mocks.loading).toHaveBeenCalledWith('drive.explorer.downloadPreparing');
    expect(mocks.prepareDownload).toHaveBeenCalledWith({ drive: 'public', path: 'work/project' });
    expect(clicked).toEqual([
      { download: 'project.zip', href: 'https://files.example.com/project.zip?sig=1' },
    ]);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.error).not.toHaveBeenCalled();
    // The anchor is gone once followed.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('says why a folder is too large, and saves nothing', async () => {
    mocks.prepareDownload.mockRejectedValue(new Error('DOWNLOAD_TOO_LARGE'));

    await download('personal', { name: 'project', path: 'project' });

    expect(mocks.error).toHaveBeenCalledWith('drive.explorer.downloadTooLarge');
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([]);
  });

  it('falls back to a generic line for a failure it has no sentence for', async () => {
    mocks.prepareDownload.mockRejectedValue(new Error('DOWNLOAD_FAILED'));

    await download('personal', { name: 'report.pdf', path: 'report.pdf' });

    expect(mocks.error).toHaveBeenCalledWith('drive.explorer.downloadFailed');
  });

  it('ignores a second click while the same entry is still being prepared', async () => {
    let finish!: (value: unknown) => void;
    mocks.prepareDownload.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useDriveDownload('public'));
    const entry = { name: 'project', path: 'project' };

    const first = result.current(entry);
    await result.current(entry);
    expect(mocks.prepareDownload).toHaveBeenCalledTimes(1);

    finish({ fileName: 'project.zip', kind: 'directory', url: 'https://files.example.com/p.zip' });
    await act(() => first);
    mocks.prepareDownload.mockResolvedValue({
      fileName: 'project.zip',
      kind: 'directory',
      url: 'https://files.example.com/p.zip',
    });
    await act(() => result.current(entry));
    expect(mocks.prepareDownload).toHaveBeenCalledTimes(2);
  });
});
