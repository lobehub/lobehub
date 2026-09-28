import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadPreviewImage } from './downloadPreviewImage';

const downloadFile = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/utils/client', () => ({ downloadFile }));

describe('downloadPreviewImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  it('opens the proxy download response for a file proxy url', async () => {
    await downloadPreviewImage('https://app.lobehub.com/f/file_abc');

    expect(window.open).toHaveBeenCalledWith(
      'https://app.lobehub.com/f/file_abc?download=1',
      '_blank',
      'noopener,noreferrer',
    );
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('downloads other sources as a blob under the file name', async () => {
    await downloadPreviewImage('https://cdn.lobehub.com/images/cat%20photo.png');

    expect(downloadFile).toHaveBeenCalledWith(
      'https://cdn.lobehub.com/images/cat%20photo.png',
      'cat photo.png',
    );
    expect(window.open).not.toHaveBeenCalled();
  });
});
