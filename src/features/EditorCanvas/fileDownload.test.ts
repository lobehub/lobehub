/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { seedAttachments } from './attachmentRegistry';
import { getFileDownloadUrl, openFileDownload } from './fileDownload';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fileDownload', () => {
  it('requests attachment delivery for file proxy URLs', () => {
    expect(
      getFileDownloadUrl('/f/file_123', {
        baseUrl: 'https://app.lobehub.com/tasks/T-201',
      }),
    ).toBe('https://app.lobehub.com/f/file_123?download=1');
  });

  it('keeps unregistered direct storage URLs unchanged', () => {
    const url = 'https://storage.example.com/video.mp4?X-Amz-Signature=signature';

    expect(getFileDownloadUrl(url, { baseUrl: 'https://app.lobehub.com/tasks/T-201' })).toBe(url);
  });

  it('routes direct storage URLs through the stable file download proxy', () => {
    const url = 'https://storage.example.com/video.mp4?X-Amz-Signature=signature';

    expect(
      getFileDownloadUrl(url, {
        downloadUrl: 'https://app.lobehub.com/f/file_video',
        fileId: 'file_video',
      }),
    ).toBe('https://app.lobehub.com/f/file_video?download=1');
  });

  it('opens the download synchronously in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    openFileDownload('/f/file_123');

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/f/file_123?download=1'),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('opens historical presigned URLs through the registered download proxy', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    seedAttachments([
      {
        downloadUrl: 'https://app.lobehub.com/f/file_historical',
        id: 'file_historical',
        url: 'https://storage.example.com/tasks/report.pdf?X-Amz-Signature=current',
      },
    ]);

    openFileDownload('https://storage.example.com/tasks/report.pdf?X-Amz-Signature=historical');

    expect(open).toHaveBeenCalledWith(
      'https://app.lobehub.com/f/file_historical?download=1',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
