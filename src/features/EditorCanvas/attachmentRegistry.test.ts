import { describe, expect, it } from 'vitest';

import { getFileIdForUrl, getRegisteredAttachment, seedAttachments } from './attachmentRegistry';

describe('attachmentRegistry', () => {
  it('matches refreshed presigned URLs without relying on their query signatures', () => {
    seedAttachments([
      {
        downloadUrl: 'https://app.lobehub.com/f/file_historical',
        id: 'file_historical',
        url: 'https://storage.example.com/tasks/report.pdf?X-Amz-Signature=current',
      },
    ]);

    const historicalUrl = 'https://storage.example.com/tasks/report.pdf?X-Amz-Signature=historical';

    expect(getFileIdForUrl(historicalUrl)).toBe('file_historical');
    expect(getRegisteredAttachment(historicalUrl)).toEqual({
      downloadUrl: 'https://app.lobehub.com/f/file_historical',
      fileId: 'file_historical',
    });
  });
});
